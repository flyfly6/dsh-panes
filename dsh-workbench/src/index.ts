/**
 * dsh-workbench — host half.
 *
 * One HTTP surface backs the browser panel:
 *
 *   POST /dsh-workbench/api   { op, args } -> { ok: true, ... } | { ok: false, code, message }
 *
 * Trust fence: the route rides DSH's own web server, so it is same-origin by
 * construction. A request is served only from a loopback authority, or when the
 * browser marks it same-origin (Sec-Fetch-Site), and it must carry the plugin
 * header — a cross-site page can forge neither.
 *
 * Lifecycle is owned by `ctx.effect`, so disabling the plugin removes the route.
 */
export const name = 'dsh-workbench'
export const inject = ['webServer']

const ROUTE_PREFIX = '/dsh-workbench/api'
const PLUGIN_HEADER = 'x-dsh-plugin'
const PLUGIN_ID = 'dsh-workbench'
const BODY_LIMIT = 1 << 20

type PluginConfig = Record<string, unknown>
type Json = Record<string, unknown>

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

function headerOf(req: any, key: string): string | undefined {
  const value = req.headers?.[key]
  return typeof value === 'string' ? value : undefined
}

function isTrusted(req: any): boolean {
  const host = headerOf(req, 'host')
  if (host === undefined || host === '') return false
  const hostname = host.replace(/^\[/, '').replace(/\]:\d+$/, '').replace(/:\d+$/, '')
  if (hostname === 'localhost' || hostname === '::1' || hostname === '0.0.0.0') return true
  if (/^127\./.test(hostname)) return true
  const site = headerOf(req, 'sec-fetch-site')
  return site === 'same-origin' || site === 'same-site'
}

function sendJson(res: any, status: number, body: Json): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function readJsonBody(req: any, limit = BODY_LIMIT): Promise<Json> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new ApiError('too-large', 'request body is too large', 413))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', (error: Error) => reject(new ApiError('transport', error.message, 500)))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim() === '') return resolve({})
      try {
        const parsed = JSON.parse(raw)
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {})
      } catch {
        reject(new ApiError('bad-request', 'request body must be JSON'))
      }
    })
  })
}

/** The op table. One entry per client-facing capability; args carry the rest. */
export function createOps(readConfig: () => PluginConfig) {
  return {
    ping: () => ({ plugin: PLUGIN_ID, alive: true }),
    'config.get': () => readConfig(),
  } as Record<string, (args: Json) => unknown | Promise<unknown>>
}

export function createHandler(readConfig: () => PluginConfig) {
  const ops = createOps(readConfig)
  return async function handle(req: any, res: any): Promise<void> {
    if (!isTrusted(req) || headerOf(req, PLUGIN_HEADER) !== PLUGIN_ID) {
      sendJson(res, 403, { ok: false, code: 'forbidden', message: 'request is not from the plugin page' })
      return
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, code: 'method-error', message: 'POST required' })
      return
    }
    let op: string
    let args: Json
    try {
      const body = await readJsonBody(req)
      op = typeof body.op === 'string' ? body.op : ''
      args = (body.args ?? {}) as Json
    } catch (error) {
      const failure = error as ApiError
      sendJson(res, failure.status ?? 400, { ok: false, code: failure.code, message: failure.message })
      return
    }
    const run = Object.prototype.hasOwnProperty.call(ops, op) ? ops[op] : undefined
    if (run === undefined) {
      sendJson(res, 404, { ok: false, code: 'unknown-op', message: `unknown op "${op}"` })
      return
    }
    try {
      sendJson(res, 200, { ok: true, data: await run(args) })
    } catch (error) {
      const failure = error as ApiError
      sendJson(res, failure.status ?? 500, {
        ok: false,
        code: failure.code ?? 'inworkbenchal',
        message: failure.message ?? String(error),
      })
    }
  }
}

export function apply(ctx: any, config: PluginConfig = {}): void {
  // ponytail: config is a plain object until the settings page lands (T1 §2.0f);
  // swap for a schemastery `Config` export when the config slot is wired.
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: createHandler(() => config) }),
    'dsh-workbench: api route',
  )
}
