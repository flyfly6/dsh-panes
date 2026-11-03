/**
 * The notes vault: creation, listing, atomic writes with etag conflicts,
 * frontmatter preservation, rename/delete and the path fence.
 */
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createNotesOps, splitFrontmatter, upsertFrontmatter } from '../src/notes.ts'

const vault = mkdtempSync(path.join(tmpdir(), 'wb-notes-'))
const configured = { notesVaultPath: vault }
const ops = createNotesOps(() => configured)

after(() => {
  /* nothing to tear down: the vault is a temp directory */
})

const call = (op, args = {}) => ops[op](args)

test('the first call creates the vault, and a fresh one lists nothing', async () => {
  const fresh = mkdtempSync(path.join(tmpdir(), 'wb-notes-empty-'))
  const other = createNotesOps(() => ({ notesVaultPath: path.join(fresh, 'vault') }))
  const config = await other['notes.config']({})
  assert.equal(config.vaultPath, path.join(fresh, 'vault'))
  assert.deepEqual(readdirSync(path.join(fresh, 'vault')), [])
  assert.deepEqual((await other['notes.list']({})).notes, [])
})

test('create writes a slugged file with frontmatter and a heading', async () => {
  const created = await call('notes.create', { title: 'My First Note' })
  assert.equal(created.path, 'my-first-note.md')
  const text = readFileSync(path.join(vault, created.path), 'utf8')
  assert.match(text, /^---\ntitle: My First Note\ncreated: /)
  /* The editor shows the title in its own input; the file carries no heading. */
  assert.equal(text.split('---').pop()?.trim(), '')
})

test('create requires a title, and the body starts empty (the editor owns the title)', async () => {
  await assert.rejects(() => call('notes.create', { title: '  ' }), (error) => {
    assert.equal(error.code, 'notes/bad-title')
    return true
  })
  const created = await call('notes.create', { title: 'Empty Body' })
  assert.equal(readFileSync(path.join(vault, created.path), 'utf8').split('---').pop()?.trim(), '')
})

test('a second note with the same title gets a numeric suffix', async () => {
  const again = await call('notes.create', { title: 'My First Note' })
  assert.equal(again.path, 'my-first-note-2.md')
})

test('write keeps unknown frontmatter fields and appends updated', async () => {
  writeFileSync(
    path.join(vault, 'obsidian.md'),
    '---\ntitle: Obsidian\naliases: [a, b]\ncustom: keep me\n---\n\nbody one\n',
    'utf8',
  )
  const read = await call('notes.read', { path: 'obsidian.md' })
  assert.equal(read.body.trim(), 'body one')
  assert.equal(read.meta.title, 'Obsidian')
  const written = await call('notes.write', { path: 'obsidian.md', body: 'body two\n', etag: read.etag })
  assert.equal(written.meta.title, 'Obsidian')
  const text = readFileSync(path.join(vault, 'obsidian.md'), 'utf8')
  assert.match(text, /aliases: \[a, b\]/)
  assert.match(text, /custom: keep me/)
  assert.match(text, /^updated: /m)
  assert.ok(text.endsWith('body two\n'), text)
})

test('a stale etag is a conflict, not an overwrite', async () => {
  const read = await call('notes.read', { path: 'obsidian.md' })
  writeFileSync(path.join(vault, 'obsidian.md'), readFileSync(path.join(vault, 'obsidian.md'), 'utf8') + 'outside\n', 'utf8')
  await assert.rejects(() => call('notes.write', { path: 'obsidian.md', body: 'clobber\n', etag: read.etag }), (error) => {
    assert.equal(error.code, 'notes/conflict')
    assert.equal(error.status, 409)
    return true
  })
  const after = readFileSync(path.join(vault, 'obsidian.md'), 'utf8')
  assert.match(after, /outside/)
})

test('rename moves the file and retitles the frontmatter', async () => {
  const created = await call('notes.create', { title: 'Old Title' })
  const renamed = await call('notes.rename', { path: created.path, title: 'New Title' })
  assert.equal(renamed.path, 'new-title.md')
  const text = readFileSync(path.join(vault, renamed.path), 'utf8')
  assert.match(text, /title: New Title/)
  assert.throws(() => readFileSync(path.join(vault, created.path), 'utf8'))
})

test('delete moves the note into .trash and out of the list', async () => {
  const created = await call('notes.create', { title: 'Throwaway' })
  const removed = await call('notes.delete', { path: created.path })
  assert.match(removed.trashed, /^\.trash\//)
  const listed = (await call('notes.list', {})).notes.map((note) => note.path)
  assert.equal(listed.includes(created.path), false)
  assert.equal(readdirSync(path.join(vault, '.trash')).length > 0, true)
})

test('search matches the body and the title, and names the line', async () => {
  const created = await call('notes.create', { title: 'Searchable' })
  await call('notes.write', { path: created.path, body: 'alpha\nneedle here\nomega\n' })
  const byBody = await call('notes.search', { query: 'needle' })
  assert.equal(byBody.hits.length, 1)
  assert.equal(byBody.hits[0].path, created.path)
  assert.equal(byBody.hits[0].line, 2)
  const byTitle = await call('notes.search', { query: 'searchable' })
  assert.equal(byTitle.hits.some((hit) => hit.path === created.path), true)
})

test('paths that leave the vault are refused', async () => {
  for (const bad of ['../escape.md', '/etc/passwd.md', '.trash/x.md', 'notes.txt', 'a/../../b.md']) {
    await assert.rejects(() => call('notes.read', { path: bad }), (error) => {
      assert.equal(error.code, 'notes/bad-path', `expected bad-path for ${bad}, got ${error.code}`)
      return true
    })
  }
})

test('a symlink is not a note address, and `..` never leaves the vault', async () => {
  const outside = mkdtempSync(path.join(tmpdir(), 'wb-outside-'))
  writeFileSync(path.join(outside, 'secret.md'), 'secret\n', 'utf8')
  mkdirSync(path.join(vault, 'sub'), { recursive: true })
  await assert.rejects(() => call('notes.read', { path: 'sub/../../secret.md' }), (error) => {
    assert.equal(error.code, 'notes/bad-path')
    return true
  })
  /* A link inside the vault to a file outside it: lstat refuses it, so the read
     cannot follow the link out and a write cannot clobber the link's target. */
  symlinkSync(path.join(outside, 'secret.md'), path.join(vault, 'link.md'))
  await assert.rejects(() => call('notes.read', { path: 'link.md' }), (error) => {
    assert.equal(error.code, 'notes/bad-path')
    return true
  })
  assert.equal(readFileSync(path.join(outside, 'secret.md'), 'utf8'), 'secret\n')
})

test('frontmatter helpers: missing fence, stray fences in the body', () => {
  const none = splitFrontmatter('plain text\n---\nnot a fence\n')
  assert.equal(none.has, false)
  assert.equal(none.body, 'plain text\n---\nnot a fence\n')
  const withMeta = splitFrontmatter('---\ntitle: t\n---\n\nbody\n')
  assert.equal(withMeta.has, true)
  assert.deepEqual(withMeta.lines, ['title: t'])
  assert.equal(withMeta.body, 'body\n')
  assert.deepEqual(upsertFrontmatter(['title: t', 'x: 1'], { title: 'new', updated: 'now' }), ['title: new', 'x: 1', 'updated: now'])
})
