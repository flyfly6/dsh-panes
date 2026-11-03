import { useEffect, useState } from 'react'

/**
 * Git status for the workbench chrome (the panel's status bar and the `git` tab
 * badge). The Git tab itself keeps its own richer state; this is the one-line
 * summary the shell needs, fetched from the same host route with `stats: false`
 * (the cheap form — no `diff --numstat` passes) and shared per project path.
 */
const API = 'dsh-ide-git/api'

export interface GitSummary {
  branch: string
  detached: boolean
  ahead: number
  behind: number
  /** Everything not yet committed: staged + unstaged + untracked + conflicted. */
  changes: number
  conflicted: number
}

interface Entry {
  value: GitSummary | null
  at: number
  busy: boolean
}

const CACHE = new Map<string, Entry>()
const listeners = new Set<() => void>()
/* ponytail: 15s TTL, one request per project per tick — the panel needs a
   number, not a live feed. Shorter when the git tab starts pushing its own
   summaries through here. */
const TTL = 15_000

function notify(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      /* a broken subscriber must not stop the others */
    }
  }
}

function count(entries: unknown): number {
  return Array.isArray(entries) ? entries.length : 0
}

async function fetchSummary(cwd: string): Promise<GitSummary | null> {
  try {
    const response = await fetch(`${API}/summary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd, stats: false }),
    })
    const body: any = await response.json()
    if (body?.ok !== true) return null
    const data = body.data ?? {}
    const changes = (data.changes ?? {}) as Record<string, unknown>
    return {
      branch: typeof data.branch === 'string' ? data.branch : '',
      detached: data.detached === true,
      ahead: Number(data.ahead ?? 0),
      behind: Number(data.behind ?? 0),
      conflicted: count(changes.conflicted),
      changes: count(changes.staged) + count(changes.unstaged) + count(changes.untracked) + count(changes.conflicted),
    }
  } catch {
    /* not a repository, or the host half is not mounted: no summary, no noise */
    return null
  }
}

/** The current summary for a project, or null when it is unknown. */
export function gitSummaryOf(cwd: string | undefined): GitSummary | null {
  if (cwd === undefined || cwd === '') return null
  return CACHE.get(cwd)?.value ?? null
}

/** Fetch when stale. Fire-and-forget: callers read the cache. */
export function refreshGitSummary(cwd: string | undefined): void {
  if (cwd === undefined || cwd === '') return
  const entry = CACHE.get(cwd)
  if (entry !== undefined && (entry.busy || Date.now() - entry.at < TTL)) return
  if (entry === undefined) CACHE.set(cwd, { value: null, at: 0, busy: true })
  else entry.busy = true
  void fetchSummary(cwd).then((value) => {
    CACHE.set(cwd, { value, at: Date.now(), busy: false })
    notify()
  })
}

export function subscribeGitSummary(listener: () => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** React binding for the chrome: refreshes on mount and every TTL while mounted. */
export function useGitSummary(cwd: string | undefined): GitSummary | null {
  const [value, setValue] = useState<GitSummary | null>(() => gitSummaryOf(cwd))
  useEffect(() => {
    setValue(gitSummaryOf(cwd))
    const off = subscribeGitSummary(() => setValue(gitSummaryOf(cwd)))
    refreshGitSummary(cwd)
    const timer = setInterval(() => refreshGitSummary(cwd), TTL)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [cwd])
  return value
}
