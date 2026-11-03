/** Shapes the host hands us through `remote.workspaceFiles` and the panel props. */

export interface Remote {
  workspaceFiles: {
    read: (
      sessionId: string,
      path: string,
      range: { offset: number; limit: number },
      signal?: AbortSignal,
    ) => Promise<{ ok: true; value: FileText } | { ok: false; error: { code: string; message: string } }>
    readBytes?: (
      sessionId: string,
      path: string,
      options: Record<string, unknown>,
      signal?: AbortSignal,
    ) => Promise<{ ok: true; value: { data: Uint8Array } } | { ok: false; error: { code: string; message: string } }>
    list: (
      sessionId: string,
      path: string,
      signal?: AbortSignal,
    ) => Promise<{ ok: true; value: DirectoryListing } | { ok: false; error: { code: string; message: string } }>
  }
}

export interface FileText {
  absolutePath: string
  version: string
  bytes?: number
  offset: number
  text: string
  lines: number
  eof: boolean
}

export interface DirectoryEntry {
  name: string
  type: 'file' | 'directory' | 'other'
}

export interface DirectoryListing {
  path: string
  entries: DirectoryEntry[]
  truncated: boolean
}

export interface Project {
  id: string
  title: string
  path: string
  sessionIds: string[]
}

export type Translate = (key: string) => string

export interface PanelProps {
  t: Translate
  close: () => void
  useWorkspaces: (selector: (snapshot: { items: any[] }) => unknown) => any
  remote?: Remote
  apps?: { key: string; label: string }[]
  /** Host call: retain a Session reference for an embedded conversation occurrence. */
  retainSession?: (sessionId: string) => { sessionId: string; release(): void }
  openPanel?: (key: string) => void
}
