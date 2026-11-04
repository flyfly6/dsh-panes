/**
 * The workspace layout, kept by the host instead of the page.
 *
 * `localStorage` is tied to the origin, and the panel origin moves whenever the
 * host picks a new port (or the site data is cleared) — the layout vanished with
 * it. The host owns a small JSON file under `$DSH_HOME/dsh-panes/`, so the tab
 * set survives a port change.
 *
 * The client still keeps a local copy: it can render before the fetch returns,
 * and the newest copy (by `updatedAt`) wins on load.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** A serialized layout is a handful of KB; this is the ceiling for a hostile one. */
const MAX_PAYLOAD = 512 * 1024

type Json = Record<string, unknown>

/** Same shape the route turns into an error body; no import cycle with index.ts. */
class LayoutError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export interface LayoutDoc {
  payload: string
  updatedAt: number
}

function defaultDir(): string {
  const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : path.join(os.homedir(), '.dsh')
  return path.join(home, 'dsh-panes')
}

export function createLayoutOps(dir: string = defaultDir()): Record<string, (args: Json) => Promise<unknown>> {
  const file = path.join(dir, 'layout.json')

  return {
    'layout.get': async () => {
      const text = await readFile(file, 'utf8').catch(() => null)
      if (text === null) return null
      try {
        const doc = JSON.parse(text) as Partial<LayoutDoc>
        return typeof doc.payload === 'string' && typeof doc.updatedAt === 'number' ? { payload: doc.payload, updatedAt: doc.updatedAt } : null
      } catch {
        /* A half-written file is not worth crashing the panel over. */
        return null
      }
    },
    'layout.set': async (args: Json) => {
      const payload = args.payload
      const updatedAt = args.updatedAt
      if (typeof payload !== 'string' || payload.length > MAX_PAYLOAD) {
        throw new LayoutError('layout/bad-payload', 'payload must be a string under 512KB')
      }
      if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
        throw new LayoutError('layout/bad-stamp', 'updatedAt must be a number')
      }
      await mkdir(dir, { recursive: true })
      // ponytail: whole-file atomic replace; a per-project shard would only pay off
      // if the layout grew past a few hundred KB.
      const temp = `${file}.${process.pid}.tmp`
      await writeFile(temp, JSON.stringify({ payload, updatedAt }), 'utf8')
      await rename(temp, file)
      return { saved: true }
    },
  }
}
