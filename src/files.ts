/**
 * Writing files back to disk.
 *
 * The panel reads through the host's `workspaceFiles` service, which is
 * read-only, so the write path lives here: one op, fenced to a workspace root,
 * atomic, and optimistic about concurrency (`etag` mismatch is a 409, not an
 * overwrite).
 */
import { chmod, lstat, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Same ceiling as the reader: past this the tab stays view-only. */
export const MAX_WRITE = 8 * 1024 * 1024

type Json = Record<string, unknown>

/** Same shape the route turns into an error body; no import cycle with index.ts. */
class FileError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export function etagOf(mtimeMs: number, size: number): string {
  return `${Math.round(mtimeMs)}:${size}`
}

async function insideRoot(root: string, target: string): Promise<string> {
  const realRoot = await realpath(root).catch(() => null)
  if (realRoot === null) throw new FileError('files/bad-root', 'workspace root does not exist', 404)
  const abs = path.resolve(realRoot, target)
  const rel = path.relative(realRoot, abs)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new FileError('files/bad-path', 'path leaves the workspace')
  }
  /* The parent must be a real directory inside the root: a symlinked directory
     would otherwise carry the write outside it. */
  const parent = await realpath(path.dirname(abs)).catch(() => null)
  if (parent === null) throw new FileError('files/not-found', 'directory does not exist', 404)
  const parentRel = path.relative(realRoot, parent)
  if (parentRel.startsWith('..') || path.isAbsolute(parentRel)) {
    throw new FileError('files/bad-path', 'path leaves the workspace')
  }
  return abs
}

export function createFileOps(): Record<string, (args: Json) => Promise<unknown>> {
  return {
    /* The reader hands back text only; the editor needs the version it loaded. */
    'file.stat': async (args: Json) => {
      const root = args.root
      const rel = args.path
      if (typeof root !== 'string' || !path.isAbsolute(root)) throw new FileError('files/bad-root', 'root must be an absolute path')
      if (typeof rel !== 'string' || rel === '') throw new FileError('files/bad-path', 'path is required')
      const abs = await insideRoot(root, rel)
      const info = await lstat(abs).catch(() => null)
      if (info === null || !info.isFile()) throw new FileError('files/not-found', 'file does not exist', 404)
      return { etag: etagOf(info.mtimeMs, info.size), size: info.size, updatedAt: info.mtimeMs }
    },
    'file.write': async (args: Json) => {
      const root = args.root
      const rel = args.path
      const content = args.content
      const etag = typeof args.etag === 'string' ? args.etag : ''
      if (typeof root !== 'string' || !path.isAbsolute(root)) throw new FileError('files/bad-root', 'root must be an absolute path')
      if (typeof rel !== 'string' || rel === '') throw new FileError('files/bad-path', 'path is required')
      if (typeof content !== 'string') throw new FileError('files/bad-content', 'content must be a string')
      const bytes = Buffer.byteLength(content, 'utf8')
      if (bytes > MAX_WRITE) throw new FileError('files/too-large', 'file is larger than 8 MiB', 413)

      const abs = await insideRoot(root, rel)
      const before = await stat(abs).catch(() => null)
      if (before === null) throw new FileError('files/not-found', 'file does not exist', 404)
      if (before.isDirectory()) throw new FileError('files/is-directory', 'path is a directory')
      const info = await lstat(abs)
      if (info.isSymbolicLink()) throw new FileError('files/bad-path', 'a symlink is not an editable file')
      if (etag !== '' && etag !== etagOf(before.mtimeMs, before.size)) {
        /* The disk moved on: hand back both sides so the UI can offer a choice. */
        const current = before.size <= MAX_WRITE ? await readFile(abs, 'utf8').catch(() => '') : ''
        throw new FileError('files/conflict', JSON.stringify({ etag: etagOf(before.mtimeMs, before.size), current }), 409)
      }

      const temp = `${abs}.${process.pid}.${Date.now().toString(36)}.tmp`
      await writeFile(temp, content, 'utf8')
      try {
        /* Keep the executable bit and friends: an edit is not a chmod. */
        await chmod(temp, before.mode)
        await rename(temp, abs)
      } catch (error) {
        await rm(temp, { force: true })
        throw error
      }
      const after = await stat(abs)
      return { etag: etagOf(after.mtimeMs, after.size), size: after.size, updatedAt: after.mtimeMs }
    },
  }
}
