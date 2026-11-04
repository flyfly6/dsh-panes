/** Calls into the plugin's host route (one same-origin POST surface, `{op,args}`). */

const PLUGIN_ID = 'dsh-panes'
const API = '/dsh-panes/api'

/** A host refusal, with the op's own code kept (callers branch on it). */
export class ApiCallError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export async function call<T = any>(op: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dsh-plugin': PLUGIN_ID },
    body: JSON.stringify({ op, args }),
    signal,
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ok !== true) {
    throw new ApiCallError(String(body?.code ?? `http/${response.status}`), body?.message ?? `HTTP ${response.status}`)
  }
  return body.data as T
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

export interface SearchResult<T> {
  hits: T[]
  truncated: boolean
}
