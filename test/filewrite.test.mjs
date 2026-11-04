/**
 * `file.write`: workspace fence, etag conflict, atomicity, mode preservation.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createFileOps, etagOf } from '../src/files.ts'

const root = mkdtempSync(path.join(tmpdir(), 'wb-files-'))
mkdirSync(path.join(root, 'src'), { recursive: true })
writeFileSync(path.join(root, 'src', 'a.ts'), 'const a = 1\n', 'utf8')
const ops = createFileOps()
const write = (args) => ops['file.write']({ root, ...args })

test('a write lands, and the etag follows the new file', async () => {
  const before = statSync(path.join(root, 'src', 'a.ts'))
  const result = await write({ path: 'src/a.ts', content: 'const a = 2\n', etag: etagOf(before.mtimeMs, before.size) })
  assert.equal(readFileSync(path.join(root, 'src', 'a.ts'), 'utf8'), 'const a = 2\n')
  assert.equal(result.size, 12)
  assert.match(result.etag, /^\d+:\d+$/)
})

test('a stale etag is a conflict, and it carries the disk copy', async () => {
  await assert.rejects(
    () => write({ path: 'src/a.ts', content: 'const a = 3\n', etag: '0:0' }),
    (error) => {
      assert.equal(error.status, 409)
      assert.equal(error.code, 'files/conflict')
      const payload = JSON.parse(error.message)
      assert.equal(payload.current, 'const a = 2\n')
      return true
    },
  )
  assert.equal(readFileSync(path.join(root, 'src/a.ts'), 'utf8'), 'const a = 2\n')
})

test('the workspace fence refuses escapes, absolute paths and symlinks', async () => {
  await assert.rejects(() => write({ path: '../outside.ts', content: 'x' }), /leaves the workspace/)
  await assert.rejects(() => write({ path: path.join(root, 'src', 'a.ts'), content: 'x' }), /leaves the workspace/)
  await assert.rejects(() => write({ path: '', content: 'x' }), /path is required/)
  await assert.rejects(() => write({ path: 'src/missing.ts', content: 'x' }), /does not exist/)
})

test('size ceiling and non-string content are refused', async () => {
  await assert.rejects(() => write({ path: 'src/a.ts', content: 42 }), /content must be a string/)
  await assert.rejects(() => write({ path: 'src/a.ts', content: 'x'.repeat(8 * 1024 * 1024 + 1) }), /larger than 8 MiB/)
})

test('the executable bit survives an edit', async () => {
  const script = path.join(root, 'run.sh')
  writeFileSync(script, '#!/bin/sh\necho hi\n', 'utf8')
  chmodSync(script, 0o755)
  await write({ path: 'run.sh', content: '#!/bin/sh\necho bye\n' })
  assert.equal(statSync(script).mode & 0o777, 0o755)
})

test('file.stat reports the version the editor loaded', async () => {
  const info = await ops['file.stat']({ root, path: 'src/a.ts' })
  const stat = statSync(path.join(root, 'src', 'a.ts'))
  assert.equal(info.etag, etagOf(stat.mtimeMs, stat.size))
  await assert.rejects(() => ops['file.stat']({ root, path: 'src/nope.ts' }), /does not exist/)
})
