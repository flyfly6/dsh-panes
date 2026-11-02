/**
 * Tab model: per-project tab sets, persisted layout, idempotent open.
 *
 * Pure functions over a plain `Layout` object so the panel can hold it in React
 * state and the persistence wrapper stays one line. Every mutation returns a new
 * object; nothing here touches the DOM, storage, or the host.
 */

export type TabKind =
  | 'session'
  | 'file'
  | 'explorer'
  | 'search'
  | 'terminal'
  | 'browser'
  | 'git'
  | 'note'

export const KNOWN_KINDS: readonly TabKind[] = [
  'session',
  'file',
  'explorer',
  'search',
  'terminal',
  'browser',
  'git',
  'note',
]

export interface TabModel {
  /** `${projectId}:${kind}:${contentId}` — dedupe key, also the React key. */
  id: string
  kind: TabKind
  contentId: string
  title: string
  params?: Record<string, unknown>
}

export interface ProjectTabs {
  tabs: TabModel[]
  activeTabId: string | null
  /** Most recent first, capped at CLOSED_LIMIT. */
  closed: TabModel[]
  sidebar: { width: number; collapsed: boolean }
}

export interface Layout {
  schemaVersion: typeof SCHEMA_VERSION
  activeProjectId: string | null
  projects: Record<string, ProjectTabs>
}

export const SCHEMA_VERSION = 2 as const
export const CLOSED_LIMIT = 10
export const SIDEBAR_WIDTH = { min: 200, max: 320, default: 248, collapsed: 52 } as const

export function emptyProject(): ProjectTabs {
  return {
    tabs: [],
    activeTabId: null,
    closed: [],
    sidebar: { width: SIDEBAR_WIDTH.default, collapsed: false },
  }
}

export function emptyLayout(): Layout {
  return { schemaVersion: SCHEMA_VERSION, activeProjectId: null, projects: {} }
}

export function tabId(projectId: string, kind: TabKind, contentId: string): string {
  return `${projectId}:${kind}:${contentId}`
}

function withProject(layout: Layout, projectId: string, next: ProjectTabs): Layout {
  return { ...layout, projects: { ...layout.projects, [projectId]: next } }
}

export function projectState(layout: Layout, projectId: string): ProjectTabs {
  return layout.projects[projectId] ?? emptyProject()
}

/** Registers a project and drops nothing; existing state is preserved. */
export function ensureProject(layout: Layout, projectId: string): Layout {
  if (layout.projects[projectId] !== undefined) return layout
  return withProject(layout, projectId, emptyProject())
}

export function setActiveProject(layout: Layout, projectId: string | null): Layout {
  return { ...layout, activeProjectId: projectId }
}

export function setSidebar(
  layout: Layout,
  projectId: string,
  patch: Partial<ProjectTabs['sidebar']>,
): Layout {
  const current = projectState(layout, projectId)
  const width = Math.min(
    SIDEBAR_WIDTH.max,
    Math.max(SIDEBAR_WIDTH.min, patch.width ?? current.sidebar.width),
  )
  return withProject(layout, projectId, {
    ...current,
    sidebar: { ...current.sidebar, ...patch, width },
  })
}

export interface OpenTabInput {
  kind: TabKind
  contentId: string
  title: string
  params?: Record<string, unknown>
}

/** Idempotent: an already-open `{kind, contentId}` is activated, params merged. */
export function openTab(layout: Layout, projectId: string, input: OpenTabInput): Layout {
  const current = projectState(layout, projectId)
  const id = tabId(projectId, input.kind, input.contentId)
  const existing = current.tabs.find((tab) => tab.id === id)
  if (existing !== undefined) {
    const tabs = current.tabs.map((tab) =>
      tab.id === id ? { ...tab, title: input.title, params: { ...tab.params, ...input.params } } : tab,
    )
    return withProject(layout, projectId, { ...current, tabs, activeTabId: id })
  }
  const tab: TabModel = {
    id,
    kind: input.kind,
    contentId: input.contentId,
    title: input.title,
    params: input.params,
  }
  return withProject(layout, projectId, { ...current, tabs: [...current.tabs, tab], activeTabId: id })
}

export function activateTab(layout: Layout, projectId: string, id: string): Layout {
  const current = projectState(layout, projectId)
  if (!current.tabs.some((tab) => tab.id === id)) return layout
  return withProject(layout, projectId, { ...current, activeTabId: id })
}

export function closeTab(layout: Layout, projectId: string, id: string): Layout {
  const current = projectState(layout, projectId)
  const index = current.tabs.findIndex((tab) => tab.id === id)
  if (index < 0) return layout
  const closedTab = current.tabs[index]!
  const tabs = current.tabs.filter((tab) => tab.id !== id)
  const activeTabId =
    current.activeTabId === id
      ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null)
      : current.activeTabId
  return withProject(layout, projectId, {
    ...current,
    tabs,
    activeTabId,
    closed: [closedTab, ...current.closed].slice(0, CLOSED_LIMIT),
  })
}

/** Reopens the most recently closed tab of this project, if any. */
export function reopenLast(layout: Layout, projectId: string): Layout {
  const current = projectState(layout, projectId)
  const [last, ...rest] = current.closed
  if (last === undefined) return layout
  const tabs = current.tabs.some((tab) => tab.id === last.id) ? current.tabs : [...current.tabs, last]
  return withProject(layout, projectId, { ...current, tabs, activeTabId: last.id, closed: rest })
}

export function moveTab(layout: Layout, projectId: string, from: number, to: number): Layout {
  const current = projectState(layout, projectId)
  if (from === to || from < 0 || to < 0 || from >= current.tabs.length || to >= current.tabs.length) {
    return layout
  }
  const tabs = [...current.tabs]
  const [moved] = tabs.splice(from, 1)
  tabs.splice(to, 0, moved!)
  return withProject(layout, projectId, { ...current, tabs })
}

export function renameTab(layout: Layout, projectId: string, id: string, title: string): Layout {
  const current = projectState(layout, projectId)
  if (title.trim() === '') return layout
  return withProject(layout, projectId, {
    ...current,
    tabs: current.tabs.map((tab) => (tab.id === id ? { ...tab, title: title.trim() } : tab)),
  })
}

/** Drops a project's tabs entirely (no migration) — used when a project vanishes. */
export function dropProject(layout: Layout, projectId: string): Layout {
  const projects = { ...layout.projects }
  delete projects[projectId]
  const activeProjectId = layout.activeProjectId === projectId ? null : layout.activeProjectId
  return { ...layout, projects, activeProjectId }
}

/**
 * Reads persisted layout, dropping anything unrecognized: unknown tab kinds,
 * unknown projects' stray tabs, out-of-range widths, wrong schema versions.
 */
export function parseLayout(raw: string | null): Layout {
  if (raw === null || raw === '') return emptyLayout()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return emptyLayout()
  }
  if (typeof parsed !== 'object' || parsed === null) return emptyLayout()
  const candidate = parsed as Record<string, unknown>
  if (candidate.schemaVersion !== SCHEMA_VERSION) return emptyLayout()

  const projects: Record<string, ProjectTabs> = {}
  const rawProjects = candidate.projects
  if (typeof rawProjects === 'object' && rawProjects !== null) {
    for (const [projectId, value] of Object.entries(rawProjects as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue
      const entry = value as Record<string, unknown>
      const tabs = Array.isArray(entry.tabs) ? entry.tabs.flatMap((raw) => parseTab(raw, projectId)) : []
      const closed = Array.isArray(entry.closed) ? entry.closed.flatMap((raw) => parseTab(raw, projectId)) : []
      const sidebar = (entry.sidebar ?? {}) as Record<string, unknown>
      const width = typeof sidebar.width === 'number' ? sidebar.width : SIDEBAR_WIDTH.default
      const activeTabId =
        typeof entry.activeTabId === 'string' && tabs.some((tab) => tab.id === entry.activeTabId)
          ? entry.activeTabId
          : (tabs[0]?.id ?? null)
      projects[projectId] = {
        tabs,
        activeTabId,
        closed: closed.slice(0, CLOSED_LIMIT),
        sidebar: {
          width: Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)),
          collapsed: sidebar.collapsed === true,
        },
      }
    }
  }
  const activeProjectId =
    typeof candidate.activeProjectId === 'string' && projects[candidate.activeProjectId] !== undefined
      ? candidate.activeProjectId
      : null
  return { schemaVersion: SCHEMA_VERSION, activeProjectId, projects }
}

function parseTab(raw: unknown, projectId: string): TabModel[] {
  if (typeof raw !== 'object' || raw === null) return []
  const entry = raw as Record<string, unknown>
  const kind = entry.kind as TabKind
  if (!KNOWN_KINDS.includes(kind)) return []
  if (typeof entry.contentId !== 'string' || typeof entry.title !== 'string') return []
  return [
    {
      id: tabId(projectId, kind, entry.contentId),
      kind,
      contentId: entry.contentId,
      title: entry.title,
      params:
        typeof entry.params === 'object' && entry.params !== null
          ? (entry.params as Record<string, unknown>)
          : undefined,
    },
  ]
}

export function serializeLayout(layout: Layout): string {
  return JSON.stringify(layout)
}
