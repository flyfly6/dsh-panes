/**
 * One runnable check for the search op: name matching, content hits, and the
 * budgets that keep a big repo from stalling the host.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { search, searchByName, searchInContent } from '../src/search.ts'

let root

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'wb-search-'))
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(join(root, 'src', 'app.ts'), 'export const alpha = 1\nconst beta = alpha + 1\n')
  await writeFile(join(root, 'src', 'app.test.ts'), 'import { alpha } from "./app"\n')
  await writeFile(join(root, 'README.md'), '# alpha docs\nalpha appears twice\n')
  await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'alpha should never be scanned\n')
  await writeFile(join(root, 'binary.bin'), Buffer.from([0x61, 0x00, 0x62]))
})

after(() => rm(root, { recursive: true, force: true }))

test('name search is fuzzy, skips ignored directories and ranks the plain name first', async () => {
  const fuzzy = await searchByName({ root, query: 'appts', mode: 'name' })
  assert.ok(fuzzy.hits.some((hit) => hit.path === 'src/app.test.ts'))
  assert.ok(fuzzy.hits.every((hit) => !hit.path.includes('node_modules')))

  const plain = await searchByName({ root, query: 'app.ts', mode: 'name' })
  assert.equal(plain.hits[0].path, 'src/app.ts')
})

test('name search respects globs and the limit', async () => {
  const { hits } = await searchByName({ root, query: 'app', mode: 'name', globs: ['*.md'] })
  assert.deepEqual(hits, [])
  const limited = await searchByName({ root, query: 'a', mode: 'name', limit: 1 })
  assert.equal(limited.hits.length, 1)
})

test('content search returns file, line and column, skipping ignored and binary files', async () => {
  const { hits, truncated } = await searchInContent({ root, query: 'alpha', mode: 'content' })
  assert.equal(truncated, false)
  const paths = hits.map((hit) => hit.path).sort()
  assert.deepEqual(paths, ['README.md', 'README.md', 'src/app.test.ts', 'src/app.ts', 'src/app.ts'])
  const first = hits.find((hit) => hit.path === 'README.md' && hit.line === 1)
  assert.equal(first.column, 3)
  assert.ok(!hits.some((hit) => hit.path.includes('node_modules') || hit.path === 'binary.bin'))
})

test('content search is case-insensitive by default and literal unless regex is set', async () => {
  const insensitive = await searchInContent({ root, query: 'ALPHA', mode: 'content' })
  assert.ok(insensitive.hits.length > 0)
  const literal = await searchInContent({ root, query: 'alpha + 1', mode: 'content' })
  assert.equal(literal.hits.length, 1)
  const regex = await searchInContent({ root, query: 'alpha \\+ 1', mode: 'content', regex: true })
  assert.equal(regex.hits.length, 1)
})

test('an invalid regex and a missing root are named errors', async () => {
  await assert.rejects(() => searchInContent({ root, query: '(', mode: 'content', regex: true }), /invalid pattern/)
  await assert.rejects(() => search({ root: join(root, 'nope'), query: 'x', mode: 'content' }), /not a directory/)
  await assert.rejects(() => search({ root: 'relative/path', query: 'x', mode: 'content' }), /absolute/)
})
