/**
 * Workspace search for the Workbench panel: file names and file contents.
 *
 * No ripgrep on this machine (checked 2026-11-03), so this is a bounded JS walk —
 * the fallback the design already allows. Budgets instead of streaming: the client
 * cancels by aborting the request, and every scan is capped in files, bytes and hits.
 */
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

const IGNORED = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.turbo', '.cache', 'coverage', '.DS_Store'])
const MAX_FILES = 20000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_HITS = 500
const CONCURRENCY = 4

export interface SearchRequest {
  root: string
  query: string
  mode?: 'name' | 'content'
  limit?: number
  regex?: boolean
  caseSensitive?: boolean
  globs?: string[]
}

export interface NameHit {
  path: string
  name: string
}

export interface ContentHit {
  path: string
  line: number
  column: number
  text: string
}

/** Rejects anything that is not an absolute directory that really exists. */
export async function resolveRoot(root: unknown): Promise<string> {
  if (typeof root !== 'string' || root === '' || root.includes('\0')) {
    throw Object.assign(new Error('root must be a directory path'), { code: 'bad-root', status: 400 })
  }
  if (!path.isAbsolute(root)) {
    throw Object.assign(new Error('root must be absolute'), { code: 'bad-root', status: 400 })
  }
  const absolute = path.resolve(root)
  const info = await stat(absolute).catch(() => null)
  if (info === null || !info.isDirectory()) {
    throw Object.assign(new Error('root is not a directory'), { code: 'bad-root', status: 400 })
  }
  return realpath(absolute)
}

/** Depth-first walk, skipping the usual noise. Returns workspace-relative paths. */
async function* walkFiles(root: string): AsyncGenerator<string> {
  const queue: string[] = ['']
  let seen = 0
  while (queue.length > 0) {
    const relative = queue.shift()!
    const directory = relative === '' ? root : path.join(root, relative)
    let entries: { name: string; isDirectory(): boolean }[]
    try {
      entries = (await readdir(directory, { withFileTypes: true })) as never
    } catch {
      continue
    }
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) {
        queue.push(child)
        continue
      }
      seen += 1
      if (seen > MAX_FILES) return
      yield child
    }
  }
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

function matchesGlobs(file: string, globs: string[]): boolean {
  if (globs.length === 0) return true
  const name = file.split('/').pop() ?? file
  return globs.some((glob) => globToRegExp(glob).test(name) || globToRegExp(glob).test(file))
}

/** Simple subsequence score so `appts` ranks `src/app.ts` but not random matches. */
function fuzzyScore(query: string, candidate: string): number {
  const needle = query.toLowerCase()
  const haystack = candidate.toLowerCase()
  let index = 0
  let score = 0
  let streak = 0
  for (const char of haystack) {
    if (char === needle[index]) {
      index += 1
      streak += 1
      score += streak
      if (index === needle.length) break
    } else {
      streak = 0
    }
  }
  if (index < needle.length) return -1
  // Prefer short names and matches late in the path (file name over directories).
  return score - haystack.length * 0.05 + (haystack.includes(needle) ? 5 : 0)
}

export async function searchByName(request: SearchRequest): Promise<{ hits: NameHit[]; truncated: boolean }> {
  const root = await resolveRoot(request.root)
  const query = String(request.query ?? '').trim()
  const limit = Math.min(Number(request.limit ?? 50) || 50, 200)
  const globs = Array.isArray(request.globs) ? request.globs : []
  if (query === '') return { hits: [], truncated: false }

  const scored: { score: number; hit: NameHit }[] = []
  for await (const file of walkFiles(root)) {
    if (!matchesGlobs(file, globs)) continue
    const score = fuzzyScore(query, file)
    if (score < 0) continue
    scored.push({ score, hit: { path: file, name: file.split('/').pop() ?? file } })
    if (scored.length > limit * 40) break
  }
  scored.sort((a, b) => b.score - a.score || a.hit.path.localeCompare(b.hit.path))
  return { hits: scored.slice(0, limit).map((entry) => entry.hit), truncated: scored.length > limit }
}

export async function searchInContent(request: SearchRequest): Promise<{ hits: ContentHit[]; truncated: boolean }> {
  const root = await resolveRoot(request.root)
  const query = String(request.query ?? '')
  const limit = Math.min(Number(request.limit ?? MAX_HITS) || MAX_HITS, MAX_HITS)
  const globs = Array.isArray(request.globs) ? request.globs : []
  if (query === '') return { hits: [], truncated: false }

  const flags = request.caseSensitive === true ? 'g' : 'gi'
  let matcher: RegExp
  try {
    matcher = new RegExp(request.regex === true ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
  } catch {
    throw Object.assign(new Error('invalid pattern'), { code: 'bad-pattern', status: 400 })
  }

  const hits: ContentHit[] = []
  let truncated = false

  const scan = async (file: string): Promise<void> => {
    if (hits.length >= limit) return
    if (!matchesGlobs(file, globs)) return
    const absolute = path.join(root, file)
    const info = await stat(absolute).catch(() => null)
    if (info === null || info.size > MAX_FILE_BYTES) return
    const buffer = await readFile(absolute).catch(() => null)
    if (buffer === null) return
    // A NUL byte in the first 8 KiB means binary: the design skips those.
    if (buffer.subarray(0, 8192).includes(0)) return
    const lines = buffer.toString('utf8').split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!
      matcher.lastIndex = 0
      if (!matcher.test(line)) continue
      const column = Math.max(0, line.search(matcher))
      hits.push({ path: file, line: index + 1, column: column + 1, text: line.slice(0, 400) })
      if (hits.length >= limit) {
        truncated = true
        return
      }
    }
  }

  let batch: string[] = []
  for await (const file of walkFiles(root)) {
    batch.push(file)
    if (batch.length < CONCURRENCY) continue
    await Promise.all(batch.map(scan))
    batch = []
    if (truncated) break
  }
  if (!truncated) await Promise.all(batch.map(scan))
  return { hits, truncated }
}

export async function search(request: SearchRequest): Promise<unknown> {
  return request.mode === 'name' ? searchByName(request) : searchInContent(request)
}
