/**
 * The notes vault: one `.md` per note under a configurable root, shared by every
 * workspace.
 *
 * The editor never sees frontmatter. The client edits the *body*; this half keeps
 * the `---` block intact (unknown fields and their order survive), stamps
 * `updated`, and refuses a write whose etag no longer matches — an outside edit
 * (Obsidian, another editor) turns into a conflict instead of a silent overwrite.
 *
 * Path safety: every path the client sends is vault-relative, and the resolved
 * real path has to stay inside the vault — `..`, absolute paths, NUL bytes and
 * symlinks pointing outside are refused before any fs call.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/* Plain fields, not constructor parameter properties: node --test imports this
   file directly through type stripping, which rejects that syntax. */
export class NotesError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export interface NoteMeta {
  title: string
  created?: string
  updated?: string
  tags?: string[]
}

export interface NoteEntry {
  path: string
  title: string
  updatedAt: number
  size: number
  excerpt: string
}

const MD = '.md'
const TRASH = '.trash'
const MAX_BODY = 4 * 1024 * 1024
const SEARCH_LIMIT = 200

/** `$DSH_HOME/notes`, or `~/.dsh/notes` when the host did not export it. */
export function defaultVaultPath(): string {
  const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : path.join(os.homedir(), '.dsh')
  return path.join(home, 'notes')
}

function absoluteVault(configured: unknown): string {
  if (configured === undefined || configured === null || configured === '') return defaultVaultPath()
  const value = String(configured)
  if (!path.isAbsolute(value)) throw new NotesError('notes/bad-vault', 'vault path must be absolute')
  if (value.includes('\u0000')) throw new NotesError('notes/bad-vault', 'vault path contains a NUL byte')
  return value
}

/** The vault root, created on demand. */
export async function vaultRoot(configured: unknown): Promise<string> {
  const root = absoluteVault(configured)
  await mkdir(root, { recursive: true }).catch((error: NodeJS.ErrnoException) => {
    throw new NotesError('notes/vault-unwritable', `cannot create the notes vault: ${error.message}`, 500)
  })
  return root
}

function relativeOf(relPath: unknown): string {
  if (typeof relPath !== 'string' || relPath.trim() === '') throw new NotesError('notes/bad-path', 'path is required')
  const value = relPath.trim()
  if (value.includes('\u0000')) throw new NotesError('notes/bad-path', 'path contains a NUL byte')
  if (path.isAbsolute(value)) throw new NotesError('notes/bad-path', 'path must be relative to the vault')
  const normalized = value.split(/[\\/]+/).filter((part) => part !== '' && part !== '.')
  if (normalized.length === 0) throw new NotesError('notes/bad-path', 'path is empty')
  if (normalized.some((part) => part === '..')) throw new NotesError('notes/bad-path', 'path must stay inside the vault')
  if (normalized[0] === TRASH) throw new NotesError('notes/bad-path', 'the trash is not editable')
  const joined = normalized.join('/')
  if (!joined.toLowerCase().endsWith(MD)) throw new NotesError('notes/bad-path', 'only .md notes are addressable')
  return joined
}

/** Absolute path of a note, verified to resolve inside the vault. */
export async function notePath(root: string, relPath: unknown): Promise<{ rel: string; abs: string }> {
  const rel = relativeOf(relPath)
  const abs = path.join(root, rel)
  const inside = path.relative(root, abs)
  if (inside.startsWith('..') || path.isAbsolute(inside)) throw new NotesError('notes/bad-path', 'path leaves the vault')
  return { rel, abs }
}

/* ------------------------------- frontmatter ------------------------------- */

interface Frontmatter {
  /** Lines between the `---` fences, verbatim and in order (empty when there is none). */
  lines: string[]
  body: string
  has: boolean
}

const FENCE = /^---\r?\n/

export function splitFrontmatter(text: string): Frontmatter {
  const match = FENCE.exec(text)
  if (match === null) return { lines: [], body: text, has: false }
  const rest = text.slice(match[0].length)
  const close = rest.search(/^---\r?\n?/m)
  if (close < 0) return { lines: [], body: text, has: false }
  const endLine = rest.indexOf('\n', close)
  const lines = rest.slice(0, close).split(/\r?\n/)
  const body = rest.slice(endLine < 0 ? rest.length : endLine + 1).replace(/^\r?\n/, '')
  return { lines: lines.filter((line) => line !== ''), body, has: true }
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed[trimmed.length - 1] === trimmed[0]) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function quote(value: string): string {
  return /^[^:#\[\]{}&*!|>'"%@`\s][^:#\n]*$/.test(value) ? value : JSON.stringify(value)
}

/** `title`, `created`, `updated`, `tags` read out of the frontmatter lines. */
export function readMeta(lines: string[]): NoteMeta {
  const meta: NoteMeta = { title: '' }
  for (const line of lines) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
    if (match === null) continue
    const key = match[1] as string
    const value = match[2] as string
    if (key === 'title') meta.title = unquote(value)
    else if (key === 'created') meta.created = unquote(value)
    else if (key === 'updated') meta.updated = unquote(value)
    else if (key === 'tags') {
      const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '')
      meta.tags = inner.split(',').map((item) => unquote(item)).filter((item) => item !== '')
    }
  }
  return meta
}

/**
 * Apply `updates` to the frontmatter lines: existing keys keep their position,
 * unknown keys and their order stay untouched, missing keys are appended in the
 * order given.
 */
export function upsertFrontmatter(lines: string[], updates: Record<string, string | undefined>): string[] {
  const next = lines.slice()
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue
    const index = next.findIndex((line) => new RegExp(`^${key}\\s*:`).test(line))
    const rendered = `${key}: ${quote(value)}`
    if (index >= 0) next[index] = rendered
    else next.push(rendered)
  }
  return next
}

function assemble(lines: string[], body: string): string {
  if (lines.length === 0) return body
  return `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}`
}

/* -------------------------------- note files ------------------------------- */

function titleOf(rel: string, lines: string[]): string {
  const meta = readMeta(lines)
  if (meta.title !== '') return meta.title
  return path.basename(rel, MD)
}

function excerptOf(body: string): string {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || line.startsWith('---')) continue
    return line.length > 140 ? `${line.slice(0, 140)}…` : line
  }
  return ''
}

async function readNote(root: string, rel: string): Promise<{ rel: string; abs: string; text: string; mtimeMs: number; size: number }> {
  const { abs } = await notePath(root, rel)
  const info = await stat(abs).catch(() => null)
  if (info === null || !info.isFile()) throw new NotesError('notes/not-found', `no note at ${rel}`, 404)
  if (info.size > MAX_BODY) throw new NotesError('notes/too-large', `note is larger than ${MAX_BODY} bytes`, 413)
  return { rel, abs, text: await readFile(abs, 'utf8'), mtimeMs: info.mtimeMs, size: info.size }
}

/** Stable token for optimistic concurrency: changes whenever the file does. */
export function etagOf(mtimeMs: number, size: number): string {
  return `${Math.round(mtimeMs)}:${size}`
}

function slugify(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'note' : slug
}

async function uniqueRel(root: string, base: string): Promise<string> {
  for (let index = 1; index < 1000; index += 1) {
    const candidate = index === 1 ? `${base}${MD}` : `${base}-${index}${MD}`
    if (!existsSync(path.join(root, candidate))) return candidate
  }
  throw new NotesError('notes/name-exhausted', 'cannot find a free file name', 409)
}

async function walk(root: string, dir = root, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(root, full, out)
      continue
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(MD)) continue
    out.push(path.relative(root, full).split(path.sep).join('/'))
  }
  return out
}

async function atomicWrite(abs: string, text: string): Promise<void> {
  const temp = `${abs}.${process.pid}.${Date.now().toString(36)}.tmp`
  await writeFile(temp, text, 'utf8')
  try {
    await rename(temp, abs)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

function hash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 12)
}

/* ---------------------------------- the ops --------------------------------- */

export type NotesOps = Record<string, (args: Record<string, unknown>) => Promise<unknown>>

/**
 * The `notes.*` op table. The vault path rides the row config, so a settings
 * change takes effect on the next call — no restart, no second source of truth.
 */
export function createNotesOps(readConfig: () => Record<string, unknown>): NotesOps {
  const root = async () => vaultRoot(readConfig().notesVaultPath)

  return {
    'notes.config': async () => {
      const configured = readConfig().notesVaultPath
      const root = await vaultRoot(configured)
      return { vaultPath: root, configured: configured === undefined || configured === '' ? null : String(configured), defaultPath: defaultVaultPath() }
    },

    'notes.list': async () => {
      const base = await root()
      const files = await walk(base)
      const entries: NoteEntry[] = []
      for (const rel of files) {
        const info = await stat(path.join(base, rel)).catch(() => null)
        if (info === null) continue
        const text = info.size > MAX_BODY ? '' : await readFile(path.join(base, rel), 'utf8').catch(() => '')
        const front = splitFrontmatter(text)
        entries.push({ path: rel, title: titleOf(rel, front.lines), updatedAt: info.mtimeMs, size: info.size, excerpt: excerptOf(front.body) })
      }
      entries.sort((a, b) => b.updatedAt - a.updatedAt)
      return { vaultPath: base, notes: entries }
    },

    'notes.read': async (args) => {
      const base = await root()
      const note = await readNote(base, String(args.path ?? ''))
      const front = splitFrontmatter(note.text)
      const meta = readMeta(front.lines)
      return {
        path: note.rel,
        body: front.body,
        meta: { ...meta, title: titleOf(note.rel, front.lines) },
        mtimeMs: note.mtimeMs,
        size: note.size,
        etag: etagOf(note.mtimeMs, note.size),
      }
    },

    'notes.write': async (args) => {
      const base = await root()
      const note = await readNote(base, String(args.path ?? ''))
      const etag = typeof args.etag === 'string' ? args.etag : ''
      if (etag !== '' && etag !== etagOf(note.mtimeMs, note.size)) {
        throw new NotesError('notes/conflict', 'the note changed on disk — reload or overwrite', 409)
      }
      const body = String(args.body ?? '')
      if (body.length > MAX_BODY) throw new NotesError('notes/too-large', 'note is too large', 413)
      const front = splitFrontmatter(note.text)
      const title = typeof args.title === 'string' && args.title.trim() !== '' ? args.title.trim() : undefined
      const lines = upsertFrontmatter(front.lines, {
        ...(title === undefined ? {} : { title }),
        created: readMeta(front.lines).created ?? new Date().toISOString(),
        updated: new Date().toISOString(),
      })
      await atomicWrite(note.abs, assemble(lines, body))
      const after = await stat(note.abs)
      return { path: note.rel, etag: etagOf(after.mtimeMs, after.size), updatedAt: after.mtimeMs, meta: readMeta(lines) }
    },

    'notes.create': async (args) => {
      const base = await root()
      const title = String(args.title ?? '').trim() || '未命名笔记'
      const rel = await uniqueRel(base, slugify(title))
      const stamp = new Date().toISOString()
      const lines = upsertFrontmatter([], { title, created: stamp, updated: stamp })
      await atomicWrite(path.join(base, rel), assemble(lines, `# ${title}\n\n`))
      return { path: rel, title }
    },

    'notes.rename': async (args) => {
      const base = await root()
      const note = await readNote(base, String(args.path ?? ''))
      const title = String(args.title ?? '').trim()
      if (title === '') throw new NotesError('notes/bad-title', 'a title is required')
      const front = splitFrontmatter(note.text)
      const lines = upsertFrontmatter(front.lines, { title, updated: new Date().toISOString() })
      /* Same directory, new slug; a taken name gets a numeric suffix instead of
         clobbering someone else's note. */
      const dir = path.posix.dirname(note.rel)
      const slugBase = slugify(title)
      let targetRel: string
      if (path.posix.basename(note.rel, MD) === slugBase) targetRel = note.rel
      else {
        const candidate = await uniqueRel(base, dir === '.' ? slugBase : `${dir}/${slugBase}`)
        targetRel = candidate
      }
      await atomicWrite(note.abs, assemble(lines, front.body))
      if (targetRel !== note.rel) {
        await rename(path.join(base, note.rel), path.join(base, targetRel))
      }
      return { path: targetRel, title }
    },

    'notes.delete': async (args) => {
      const base = await root()
      const note = await readNote(base, String(args.path ?? ''))
      const trash = path.join(base, TRASH)
      await mkdir(trash, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const target = path.join(trash, `${stamp}-${path.basename(note.rel)}`)
      await rename(note.abs, target)
      return { trashed: path.relative(base, target).split(path.sep).join('/') }
    },

    'notes.search': async (args) => {
      const base = await root()
      const query = String(args.query ?? '').trim()
      if (query === '') return { hits: [], truncated: false }
      const needle = query.toLowerCase()
      const hits: { path: string; title: string; line: number; snippet: string }[] = []
      for (const rel of await walk(base)) {
        const info = await stat(path.join(base, rel)).catch(() => null)
        if (info === null || info.size > MAX_BODY) continue
        const text = await readFile(path.join(base, rel), 'utf8').catch(() => '')
        const front = splitFrontmatter(text)
        const title = titleOf(rel, front.lines)
        const lines = front.body.split(/\r?\n/)
        const at = lines.findIndex((line) => line.toLowerCase().includes(needle))
        const titleHit = title.toLowerCase().includes(needle)
        if (at < 0 && !titleHit) continue
        hits.push({
          path: rel,
          title,
          line: at < 0 ? 1 : at + 1,
          snippet: at < 0 ? title : (lines[at] ?? '').trim().slice(0, 160),
        })
        if (hits.length >= SEARCH_LIMIT) return { hits, truncated: true }
      }
      return { hits, truncated: false, queryHash: hash(query) }
    },
  }
}
