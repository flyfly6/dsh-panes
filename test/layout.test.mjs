/**
 * The host-side layout file: round trip, newest-wins stamp, and the guards that
 * keep a hostile or corrupted file from breaking the panel.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createLayoutOps } from '../src/layoutStore.ts'

const dir = mkdtempSync(path.join(tmpdir(), 'wb-layout-'))
const ops = createLayoutOps(dir)

test('a layout round-trips through the host file', async () => {
  assert.equal(await ops['layout.get']({}), null)
  await ops['layout.set']({ payload: '{"projects":{}}', updatedAt: 10 })
  assert.deepEqual(await ops['layout.get']({}), { payload: '{"projects":{}}', updatedAt: 10 })
  /* A later save replaces the file, not appends to it. */
  await ops['layout.set']({ payload: '{"projects":{},"activeProjectId":"p"}', updatedAt: 20 })
  assert.deepEqual(await ops['layout.get']({}), { payload: '{"projects":{},"activeProjectId":"p"}', updatedAt: 20 })
})

test('bad payloads are rejected instead of written', async () => {
  await assert.rejects(() => ops['layout.set']({ payload: 42, updatedAt: 1 }), /payload must be a string/)
  await assert.rejects(() => ops['layout.set']({ payload: 'x'.repeat(512 * 1024 + 1), updatedAt: 1 }), /payload must be a string/)
  await assert.rejects(() => ops['layout.set']({ payload: '{}', updatedAt: 'now' }), /updatedAt must be a number/)
  assert.equal((await ops['layout.get']({}))?.updatedAt, 20)
})

test('a corrupted file reads as "no layout" instead of throwing', async () => {
  writeFileSync(path.join(dir, 'layout.json'), '{not json', 'utf8')
  assert.equal(await ops['layout.get']({}), null)
})
