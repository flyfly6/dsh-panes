/**
 * Workspace search for the Workbench panel: file names and file contents.
 *
 * Engine order: the machine's own `rg`, then the `rg` this package bundles, then a
 * bounded JS walk (the fallback the design allows). Budgets are identical in all
 * three: ignored directories, 2 MiB files, 500 hits, abortable.
 */
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { rgPath, runRg } from './ripgrep'

const IGNORED = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.turbo', '.cache', 'coverage', '.DS_Store'])
const MAX_FILES = 20000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_HITS = 500
const CONCURRENCY = 4
/** Always excluded, whatever the repository's ignore files say. */
const RG_EXCLUDES = ['!node_modules/**', '!.git/**']

export type Engine = 'auto' | 'rg' | 'js'

export interface SearchRequest {
  root: string
  query: string
  mode?: 'name' | 'content'
  limit?: number
  regex?: boolean
  caseSensitive?: boolean
  globs?: string[]
  /** `js` forces the JS walk; `auto` prefers rg. Tests use both. */
  engine?: Engine
  signal?: AbortSignal
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

export interface SearchReport<T> {
  hits: T[]
  truncated: boolean
  engine: 'system-rg' | 'bundled-rg' | 'js'
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

function useRg(engine: Engine): 'system-rg' | 'bundled-rg' | null {
  if (engine === 'js') return null
  const found = rgPath()
  if (found === null) return null
  return found.source === 'system' ? 'system-rg' : 'bundled-rg'
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

function rank(files: string[], query: string, limit: number): NameHit[] {
  const scored: { score: number; hit: NameHit }[] = []
  for (const file of files) {
    const score = fuzzyScore(query, file)
    if (score < 0) continue
    scored.push({ score, hit: { path: file, name: file.split('/').pop() ?? file } })
  }
  scored.sort((a, b) => b.score - a.score || a.hit.path.localeCompare(b.hit.path))
  return scored.slice(0, limit).map((entry) => entry.hit)
}

export async function searchByName(request: SearchRequest): Promise<SearchReport<NameHit>> {
  const root = await resolveRoot(request.root)
  const query = String(request.query ?? '').trim()
  const limit = Math.min(Number(request.limit ?? 50) || 50, 200)
  const globs = Array.isArray(request.globs) ? request.globs : []
  const engine = useRg(request.engine ?? 'auto')
  if (query === '') return { hits: [], truncated: false, engine: engine ?? 'js' }

  if (engine !== null) {
    const args = ['--files', ...RG_EXCLUDES.flatMap((glob) => ['--glob', glob])]
    for (const glob of globs) args.push('--glob', glob)
    try {
      const files = await runRg({ cwd: root, args, maxLines: MAX_FILES, signal: request.signal })
      const hits = rank(files, query, limit)
      return { hits, truncated: hits.length >= limit, engine }
    } catch {
      /* fall through to the JS walk */
    }
  }

  const files: string[] = []
  for await (const file of walkFiles(root)) {
    if (!matchesGlobs(file, globs)) continue
    files.push(file)
    if (files.length >= MAX_FILES) break
  }
  const hits = rank(files, query, limit)
  return { hits, truncated: hits.length >= limit, engine: 'js' }
}

interface RgMatch {
  type?: string
  data?: {
    path?: { text?: string }
    lines?: { text?: string }
    line_number?: number
    submatches?: { start?: number }[]
  }
}

/** `start` is a byte offset into the line; convert it to a 1-based character column. */
function columnOf(text: string, byteOffset: number): number {
  const prefix = Buffer.from(text, 'utf8').subarray(0, byteOffset).toString('utf8')
  return [...prefix].length + 1
}

export async function searchInContent(request: SearchRequest): Promise<SearchReport<ContentHit>> {
  const root = await resolveRoot(request.root)
  const query = String(request.query ?? '')
  const limit = Math.min(Number(request.limit ?? MAX_HITS) || MAX_HITS, MAX_HITS)
  const globs = Array.isArray(request.globs) ? request.globs : []
  const engine = useRg(request.engine ?? 'auto')
  if (query === '') return { hits: [], truncated: false, engine: engine ?? 'js' }

  const regex = request.regex === true
  if (regex) {
    try {
      new RegExp(query)
    } catch {
      throw Object.assign(new Error('invalid pattern'), { code: 'bad-pattern', status: 400 })
    }
  }

  if (engine !== null) {
    const args = [
      '--json',
      '--max-columns',
      '400',
      '--max-columns-preview',
      request.caseSensitive === true ? '--case-sensitive' : '--ignore-case',
      ...(regex ? [] : ['--fixed-strings']),
      ...RG_EXCLUDES.flatMap((glob) => ['--glob', glob]),
      ...globs.flatMap((glob) => ['--glob', glob]),
      '--',
      query,
      '.',
    ]
    try {
      const lines = await runRg({ cwd: root, args, maxLines: limit + 1, signal: request.signal })
      const hits: ContentHit[] = []
      for (const line of lines) {
        if (hits.length >= limit) break
        let record: RgMatch
        try {
          record = JSON.parse(line) as RgMatch
        } catch {
          continue
        }
        if (record.type !== 'match' || record.data === undefined) continue
        const text = (record.data.lines?.text ?? '').replace(/\r?\n$/, '')
        const file = (record.data.path?.text ?? '').replace(/^\.\//, '')
        hits.push({
          path: file,
          line: record.data.line_number ?? 1,
          column: columnOf(text, record.data.submatches?.[0]?.start ?? 0),
          text: text.slice(0, 400),
        })
      }
      return { hits, truncated: hits.length >= limit, engine }
    } catch {
      /* fall through to the JS walk */
    }
  }

  const flags = request.caseSensitive === true ? 'g' : 'gi'
  let matcher: RegExp
  try {
    matcher = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
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
  return { hits, truncated, engine: 'js' }
}

export async function search(request: SearchRequest): Promise<unknown> {
  return request.mode === 'name' ? searchByName(request) : searchInContent(request)
}
