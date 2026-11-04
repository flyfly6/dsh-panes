/**
 * Tab model: per-project tab sets, persisted layout, idempotent open.
 *
 * Pure functions over a plain `Layout` object so the panel can hold it in React
 * state and the persistence wrapper stays one line. Every mutation returns a new
 * object; nothing here touches the DOM, storage, or the host.
 */

/**
 * A tab kind is any string: a registered tab type owns its kind, so a third
 * party can add one without editing this file (the registry is the source of
 * truth for what exists, this model only stores what was opened).
 */
export type TabKind = string

/** The kinds the shell itself knows how to build from the `+` menu. */
export const BUILTIN_KINDS = ['session', 'file', 'explorer', 'search', 'terminal', 'git', 'note', 'notes'] as const

/** Which of the two panes a tab lives in (v0.3 split view). */
export type Pane = 'primary' | 'secondary'

/** One project's split: the secondary pane's orientation and its active tab. */
export interface Split {
  orientation: 'row' | 'col'
  activeTabId: string | null
}

export interface TabModel {
  /** `${projectId}:${kind}:${contentId}` — dedupe key, also the React key. */
  id: string
  kind: TabKind
  contentId: string
  title: string
  params?: Record<string, unknown>
  /** Absent means `primary` (the pane every pre-v0.3 layout had). */
  pane?: Pane
}

export interface ProjectTabs {
  tabs: TabModel[]
  activeTabId: string | null
  /** Most recent first, capped at CLOSED_LIMIT. */
  closed: TabModel[]
  sidebar: { width: number; collapsed: boolean }
  /** `null` = one pane. Set by splitting; cleared when the pane empties. */
  split: Split | null
}

export interface Layout {
  schemaVersion: typeof SCHEMA_VERSION
  activeProjectId: string | null
  projects: Record<string, ProjectTabs>
}

export const SCHEMA_VERSION = 3 as const
export const CLOSED_LIMIT = 10
export const SIDEBAR_WIDTH = { min: 200, max: 320, default: 248, collapsed: 52 } as const

export function emptyProject(): ProjectTabs {
  return {
    tabs: [],
    activeTabId: null,
    closed: [],
    sidebar: { width: SIDEBAR_WIDTH.default, collapsed: false },
    split: null,
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
  const tab = current.tabs.find((candidate) => candidate.id === id)
  if (tab === undefined) return layout
  if (tab.pane === 'secondary' && current.split !== null) {
    return withProject(layout, projectId, { ...current, split: { ...current.split, activeTabId: id } })
  }
  return withProject(layout, projectId, { ...current, activeTabId: id })
}

export function closeTab(layout: Layout, projectId: string, id: string): Layout {
  const current = projectState(layout, projectId)
  const index = current.tabs.findIndex((tab) => tab.id === id)
  if (index < 0) return layout
  const closedTab = current.tabs[index]!
  const tabs = current.tabs.filter((tab) => tab.id !== id)
  const secondary = tabs.filter((tab) => tab.pane === 'secondary')
  /* A split with nothing left in its pane is not a split anymore. */
  const split =
    current.split === null || secondary.length === 0
      ? null
      : current.split.activeTabId === id
        ? { ...current.split, activeTabId: secondary[Math.min(index, secondary.length - 1)]!.id }
        : current.split
  const primary = tabs.filter((tab) => (tab.pane ?? 'primary') === 'primary')
  const activeTabId = primary.some((tab) => tab.id === current.activeTabId)
    ? current.activeTabId
    : (primary[primary.length - 1]?.id ?? null)
  return withProject(layout, projectId, {
    ...current,
    tabs,
    activeTabId,
    split,
    closed: [closedTab, ...current.closed].slice(0, CLOSED_LIMIT),
  })
}

/** Split the active tab into a second pane (no-op when already split). */
export function splitActive(layout: Layout, projectId: string, orientation: Split['orientation'] = 'row'): Layout {
  const current = projectState(layout, projectId)
  const id = current.activeTabId
  if (id === null || current.split !== null) return layout
  const tabs = current.tabs.map((tab) => (tab.id === id ? { ...tab, pane: 'secondary' as Pane } : tab))
  const primary = tabs.filter((tab) => (tab.pane ?? 'primary') === 'primary')
  return withProject(layout, projectId, {
    ...current,
    tabs,
    activeTabId: primary[primary.length - 1]?.id ?? null,
    split: { orientation, activeTabId: id },
  })
}

/** Pull every secondary tab back into one pane and drop the split. */
export function unsplit(layout: Layout, projectId: string): Layout {
  const current = projectState(layout, projectId)
  if (current.split === null) return layout
  const tabs = current.tabs.map(({ pane: _pane, ...tab }) => tab)
  return withProject(layout, projectId, {
    ...current,
    tabs,
    activeTabId: current.split.activeTabId ?? current.activeTabId,
    split: null,
  })
}

/** Move one tab across panes; an emptied secondary pane closes the split. */
export function togglePane(layout: Layout, projectId: string, id: string): Layout {
  const current = projectState(layout, projectId)
  const tab = current.tabs.find((candidate) => candidate.id === id)
  if (tab === undefined) return layout
  const toSecondary = (tab.pane ?? 'primary') === 'primary'
  if (toSecondary && current.split === null) return splitActive(layout, projectId)
  const tabs = current.tabs.map((candidate) =>
    candidate.id === id ? { ...candidate, pane: toSecondary ? ('secondary' as Pane) : undefined } : candidate,
  )
  const secondary = tabs.filter((candidate) => candidate.pane === 'secondary')
  if (secondary.length === 0) {
    return withProject(layout, projectId, {
      ...current,
      tabs: tabs.map(({ pane: _pane, ...rest }) => rest),
      activeTabId: id,
      split: null,
    })
  }
  const primary = tabs.filter((candidate) => (candidate.pane ?? 'primary') === 'primary')
  return withProject(layout, projectId, {
    ...current,
    tabs,
    activeTabId: toSecondary ? (primary[primary.length - 1]?.id ?? null) : id,
    split: current.split === null ? { orientation: 'row', activeTabId: id } : { ...current.split, activeTabId: toSecondary ? (secondary[secondary.length - 1]?.id ?? id) : id },
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
 * Reads persisted layout, dropping anything unrecognizable: malformed tab
 * entries, out-of-range widths, a wrong schema version. Tab kinds are kept as-is
 * (a plugin-registered kind must survive a reload); a kind with no registered
 * renderer falls back to the shell's "not available" card.
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
  /* v2 layouts predate the split view; they restore into the primary pane. */
  if (candidate.schemaVersion !== SCHEMA_VERSION && candidate.schemaVersion !== 2) return emptyLayout()

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
      const split = parseSplit(entry.split, tabs)
      projects[projectId] = {
        tabs,
        activeTabId,
        closed: closed.slice(0, CLOSED_LIMIT),
        sidebar: {
          width: Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)),
          collapsed: sidebar.collapsed === true,
        },
        split,
      }
    }
  }
  const activeProjectId =
    typeof candidate.activeProjectId === 'string' && projects[candidate.activeProjectId] !== undefined
      ? candidate.activeProjectId
      : null
  return { schemaVersion: SCHEMA_VERSION, activeProjectId, projects }
}

/** A split survives only when its pane still has a tab to show. */
function parseSplit(raw: unknown, tabs: TabModel[]): Split | null {
  if (typeof raw !== 'object' || raw === null) return null
  const entry = raw as Record<string, unknown>
  if (entry.orientation !== 'row' && entry.orientation !== 'col') return null
  const secondary = tabs.filter((tab) => tab.pane === 'secondary')
  if (secondary.length === 0) return null
  const wanted = typeof entry.activeTabId === 'string' ? entry.activeTabId : undefined
  const activeTabId = secondary.some((tab) => tab.id === wanted) ? wanted! : secondary[0]!.id
  return { orientation: entry.orientation, activeTabId }
}

function parseTab(raw: unknown, projectId: string): TabModel[] {
  if (typeof raw !== 'object' || raw === null) return []
  const entry = raw as Record<string, unknown>
  const kind = entry.kind
  if (typeof kind !== 'string' || kind.trim() === '') return []
  /* v0.3 dropped the browser tab (a plugin cannot use `<webview>`: the host only
     attaches its own leased guests). Old layouts keep loading; their browser
     tabs are simply not restored. */
  if (kind === 'browser') return []
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
      pane: entry.pane === 'secondary' ? 'secondary' : undefined,
    },
  ]
}

export function serializeLayout(layout: Layout): string {
  return JSON.stringify(layout)
}
