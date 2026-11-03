/**
 * ripgrep resolution: the host's own `rg` first, the bundled one second.
 *
 * Bundled means `@vscode/ripgrep` — a runtime dependency of the package, so a
 * profile install brings its platform binary along. When neither exists the search
 * falls back to the JS walk in ./search.
 */
import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

let bundled: string | null | undefined
let system: string | null | undefined

/** First executable `rg` on PATH, if any. */
export function systemRg(): string | null {
  if (system !== undefined) return system
  system = null
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (directory === '') continue
    const candidate = path.join(directory, process.platform === 'win32' ? 'rg.exe' : 'rg')
    try {
      accessSync(candidate, constants.X_OK)
      system = candidate
      break
    } catch {
      /* keep looking */
    }
  }
  return system
}

/** The binary shipped with this package, if the install left one behind. */
export function bundledRg(): string | null {
  if (bundled !== undefined) return bundled
  bundled = null
  try {
    const resolved = (require('@vscode/ripgrep') as { rgPath?: unknown }).rgPath
    if (typeof resolved === 'string') {
      accessSync(resolved, constants.X_OK)
      bundled = resolved
    }
  } catch {
    /* not installed for this platform */
  }
  return bundled
}

export function rgPath(): { binary: string; source: 'system' | 'bundled' } | null {
  const fromSystem = systemRg()
  if (fromSystem !== null) return { binary: fromSystem, source: 'system' }
  const fromBundle = bundledRg()
  return fromBundle === null ? null : { binary: fromBundle, source: 'bundled' }
}

export interface RunOptions {
  cwd: string
  args: string[]
  /** Stop the child once this many stdout lines arrived. */
  maxLines?: number
  signal?: AbortSignal
}

/** Runs rg and collects stdout lines; kills the child at the line cap or on abort. */
export function runRg({ cwd, args, maxLines = 500, signal }: RunOptions): Promise<string[]> {
  const found = rgPath()
  if (found === null) return Promise.resolve([])
  return new Promise((resolve, reject) => {
    const child = spawn(found.binary, args, { cwd, env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    const lines: string[] = []
    let buffered = ''
    let settled = false

    const stop = (): void => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      resolve(lines)
    }

    signal?.addEventListener('abort', stop, { once: true })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buffered += chunk
      let index = buffered.indexOf('\n')
      while (index >= 0) {
        lines.push(buffered.slice(0, index))
        buffered = buffered.slice(index + 1)
        if (lines.length >= maxLines) {
          stop()
          return
        }
        index = buffered.indexOf('\n')
      }
    })
    child.on('error', (error) => {
      if (!settled) {
        settled = true
        reject(error)
      }
    })
    // rg exits 1 when nothing matched: an empty result, not a failure.
    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (buffered !== '') lines.push(buffered)
      if (code === 0 || code === 1) resolve(lines)
      else reject(new Error(`rg exited with ${code}`))
    })
  })
}
