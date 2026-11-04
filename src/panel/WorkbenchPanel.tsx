import * as React from 'react'
import {
  ArrowLeft,
  Box,
  ChevronsLeft,
  ChevronsRight,
  Circle,
  Folder,
  FolderPlus,
  GitBranch,
  MoreHorizontal,
  Plus,
  Search,
  Sun,
  Moon,
  X,
} from 'lucide-react'
import {
  activateTab,
  closeTab,
  ensureProject,
  displayTitle,
  moveTab,
  openTab,
  renameTab,
  shiftTab,
  splitActive,
  tabsLeftOf,
  tabsRightOf,
  togglePane,
  unsplit,
  parseLayout,
  projectState,
  reopenLast,
  serializeLayout,
  setActiveProject,
  setSidebar,
  SIDEBAR_WIDTH,
  type Layout,
  type ProjectTabs,
  type TabKind,
  type TabModel,
} from '../tabs'
import { call } from '../api'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Input } from '../ui/input'
import { cn } from '../ui/cn'
import { ExplorerView } from './ExplorerView'
import { FileView } from './FileView'
import { SessionCard } from './SessionCard'
import { Guarded } from './Guarded'
import { closeTerminalModel, TerminalView as TerminalPane, type TerminalModel } from './TerminalView'
import { useGitSummary } from '../git/status'
import { MarkdownView } from './MarkdownView'
import { QuickOpen } from './QuickOpen'
import { SearchView } from './SearchView'
import { KindIcon } from './icons'
import { isNoteDirty, noteStatusOf, subscribeNoteStatus } from '../notes/store'
import { isDark, languageLabel } from '../highlight'
import type { PanelProps, Project, Translate } from './types'

const STORE_KEY = 'dsh-panes:layout'
const STORE_STAMP = 'dsh-panes:layout-stamp'
const LAST_PANEL_KEY = 'dsh-panes:last-panel'

/** What a registered tab type gets to draw its body. */
export interface TabRenderProps {
  tab: TabModel
  /** The panel's translator (same dictionary the shell uses). */
  t: Translate
  /** The project the tab belongs to (its `path` is the folder every view roots at). */
  project?: Project
  /** The project's session: host services (terminal, conversation) key on it. */
  sessionId?: string
  /** Open (or focus) another tab in this project. */
  open: (input: { kind: TabKind; contentId: string; title: string; params?: Record<string, unknown> }) => void
  /** Open a file tab, optionally at a line. */
  openFile: (path: string, line?: number, name?: string) => void
  /** Rename the current tab in place (a note retitles itself from its frontmatter). */
  retitle: (title: string) => void
  /** Every project, for tabs that move their content between them. */
  projects: { path: string; title: string }[]
}

export interface TabTypeSpec {
  kind: TabKind
  order?: number
  /** Strip glyph; the shell falls back to its own glyph when absent. */
  icon?: React.ReactNode
  render?: (props: TabRenderProps) => React.ReactNode
}

export interface TabRegistry {
  register(spec: TabTypeSpec): () => void
  get(kind: string): TabTypeSpec | undefined
  kinds(): TabTypeSpec[]
}

export function createRegistry(): TabRegistry {
  const types = new Map<string, TabTypeSpec>()
  return {
    register(spec) {
      types.set(spec.kind, spec)
      return () => void types.delete(spec.kind)
    },
    get: (kind) => types.get(kind),
    kinds: () => [...types.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
  }
}

/** Appearance settings the panel reads on every render (live row config, R10). */
export interface Appearance {
  uiFamily: string
  uiSize: number
  codeFamily: string
  codeSize: number
  codeLineHeight: number
}

function readStored(): Layout {
  try {
    return parseLayout(window.localStorage.getItem(STORE_KEY))
  } catch {
    return parseLayout(null)
  }
}

function projectsOf(items: unknown): Project[] {
  return (Array.isArray(items) ? items : []).map((item: any) => ({
    id: String(item.workspaceId ?? item.id ?? item.path),
    title: String(item.title ?? item.path ?? ''),
    path: String(item.path ?? ''),
    sessionIds: Array.isArray(item.sessionIds) ? item.sessionIds.map(String) : [],
    running: item.running === true || item.status === 'running',
  }))
}

/** `~/projects/app` — the sidebar shows home-relative paths, like the design. */
function shortPath(path: string, home?: string): string {
  if (home !== undefined && home !== '' && path.startsWith(home)) return `~${path.slice(home.length)}`
  const match = /^\/(?:Users|home)\/[^/]+/.exec(path)
  return match === null ? path : `~${path.slice(match[0].length)}`
}

function kindParam(tab: TabModel): string {
  const value = tab.params?.line
  return typeof value === 'number' ? String(value) : ''
}

/** One terminal occurrence: the host model is created once per tab. */
function TerminalTab({
  tabId,
  contentId,
  sessionId,
  openModel,
  t,
}: {
  tabId: string
  contentId: string
  sessionId: string
  openModel: (sessionId: string, key: string, contentId: string) => unknown
  t: (key: string) => string
}) {
  const model = React.useMemo(
    () => openModel(sessionId, tabId, contentId) as TerminalModel,
    [contentId, openModel, sessionId, tabId],
  )
  return <TerminalPane modelKey={`${sessionId}:${tabId}`} model={model} t={t} />
}

/** Retains a Session reference for as long as the tab lives, then releases it. */
/** Scroll offsets of session tabs, so switching back does not jump to the top. */
const SESSION_SCROLL = new Map<string, number>()

/** The transcript's own scroller — the host builds it, so it is found by shape. */
function findScroller(host: HTMLElement): HTMLElement | null {
  let best: HTMLElement | null = null
  for (const node of host.querySelectorAll<HTMLElement>('div, section, main')) {
    if (node.scrollHeight <= node.clientHeight + 4) continue
    if (!/(auto|scroll)/.test(getComputedStyle(node).overflowY)) continue
    if (best === null || node.scrollHeight > best.scrollHeight) best = node
  }
  return best
}

function EmbeddedConversation({
  sessionId,
  SessionProvider,
  renderSlot,
  retainSession,
  retitle,
}: {
  sessionId: string
  SessionProvider: React.ComponentType<any>
  renderSlot: (key: string, owner: unknown) => React.ReactNode
  retainSession: (sessionId: string) => { sessionId: string; release(): void }
  retitle?: (title: string) => void
}) {
  const reference = React.useMemo(() => retainSession(sessionId), [retainSession, sessionId])
  const hostRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => () => reference.release(), [reference])

  /* The session log owns the title; read the last `session/title` event so the
     tab and breadcrumb say the same thing the default UI says. */
  React.useEffect(() => {
    if (retitle === undefined) return undefined
    const read = () => {
      const window = (reference as any).binding?.eventSource?.getSnapshot?.()
      const entries = Array.isArray(window?.entries) ? window.entries.slice(-200) : []
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]
        if (entry?.type !== 'event' || entry.event?.type !== 'session/title') continue
        const title = entry.event.data?.title
        if (typeof title === 'string' && title.trim() !== '') retitle(title.trim())
        return
      }
    }
    read()
    const source = (reference as any).binding?.eventSource
    if (typeof source?.subscribe !== 'function') return undefined
    return source.subscribe(read)
  }, [reference, retitle])

  /* ponytail: the scroll container belongs to the host's transcript, so it is
     located by shape and polled while the conversation mounts. If the host ever
     exposes the scroller, drop the search and keep the map. */
  React.useEffect(() => {
    const host = hostRef.current
    if (host === null) return undefined
    let element: HTMLElement | null = null
    let timer: number | null = null
    let attempts = 0
    const attach = () => {
      element = findScroller(host)
      if (element === null) {
        if (attempts < 30) {
          attempts += 1
          timer = window.setTimeout(attach, 100)
        }
        return
      }
      const saved = SESSION_SCROLL.get(sessionId) ?? 0
      if (saved > 0) element.scrollTop = saved
      element.addEventListener('scroll', remember, { passive: true })
    }
    const remember = () => {
      if (element !== null) SESSION_SCROLL.set(sessionId, element.scrollTop)
    }
    attach()
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      if (element !== null) {
        remember()
        element.removeEventListener('scroll', remember)
      }
    }
  }, [sessionId])

  return (
    <div ref={hostRef} className="h-full min-h-0">
      <SessionProvider session={reference}>{renderSlot('workbench.conversation', {})}</SessionProvider>
    </div>
  )
}

/** Side chats live per main session: `<mainSessionId> -> [forked sessionId]`. */
const SIDES_KEY = 'dsh-panes:sides'

function readSides(mainId: string): string[] {
  try {
    const all = JSON.parse(window.localStorage.getItem(SIDES_KEY) ?? '{}') as Record<string, unknown>
    const list = all?.[mainId]
    return Array.isArray(list) ? list.map(String).filter((id) => id !== '') : []
  } catch {
    return []
  }
}

function writeSides(mainId: string, list: string[]): void {
  try {
    const all = JSON.parse(window.localStorage.getItem(SIDES_KEY) ?? '{}') as Record<string, unknown>
    const next = all !== null && typeof all === 'object' ? all : {}
    if (list.length === 0) delete next[mainId]
    else next[mainId] = list
    window.localStorage.setItem(SIDES_KEY, JSON.stringify(next))
  } catch {
    /* private mode */
  }
}

/**
 * A session tab plus its side chats (T3). A side chat is a host fork of the main
 * session, so it starts with the conversation's history and is a real session on
 * its own. ponytail: fixed 380px dock (no drag), no quote/return-to-main plumbing
 * (the Client exposes no composer writer) — the fork itself is the useful part.
 */
function SessionTabView({
  sessionId,
  SessionProvider,
  renderSlot,
  retainSession,
  retitle,
  forkSession,
  t,
}: {
  sessionId: string
  SessionProvider: React.ComponentType<any>
  renderSlot: (key: string, owner: unknown) => React.ReactNode
  retainSession: (sessionId: string) => { sessionId: string; release(): void }
  retitle?: (title: string) => void
  forkSession?: (sessionId: string) => Promise<string | undefined>
  t: Translate
}) {
  const [sides, setSides] = React.useState<string[]>(() => readSides(sessionId))
  const [side, setSide] = React.useState<string | undefined>(() => readSides(sessionId)[0])
  const [dock, setDock] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [forkFailed, setForkFailed] = React.useState(false)

  const update = (next: string[]) => {
    setSides(next)
    writeSides(sessionId, next)
  }

  const openSide = async () => {
    if (forkSession === undefined || busy) return
    setBusy(true)
    try {
      const created = await forkSession(sessionId)
      setForkFailed(created === undefined)
      if (created === undefined) return
      update([...sides, created])
      setSide(created)
      setDock(true)
    } finally {
      setBusy(false)
    }
  }

  const closeSide = (id: string) => {
    const next = sides.filter((entry) => entry !== id)
    update(next)
    if (side === id) setSide(next[next.length - 1])
    if (next.length === 0) setDock(false)
  }

  /* Alt+S toggles the dock; skipped while typing so the host composer keeps it. */
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.key.toLowerCase() !== 's') return
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable === true) return
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return
      event.preventDefault()
      setDock((open) => !open)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full min-h-0">
      <div className="relative min-w-0 flex-1">
        <EmbeddedConversation
          sessionId={sessionId}
          SessionProvider={SessionProvider}
          renderSlot={renderSlot}
          retainSession={retainSession}
          retitle={retitle}
        />
        {!dock && forkSession !== undefined && (
          <button
            type="button"
            onClick={() => setDock(true)}
            title={t('side.toggle')}
            className="absolute right-1.5 top-1.5 z-10 rounded border border-border bg-[var(--card)] px-1.5 py-0.5 text-2xs text-muted-foreground hover:text-foreground"
          >
            {t('side.title')}
          </button>
        )}
      </div>
      {dock && (
        /* Proportional so a squeezed (split) pane keeps its conversation readable. */
        <aside
          className="flex w-2/5 max-w-[380px] min-w-[220px] shrink-0 flex-col border-l border-border"
          aria-label={t('side.title')}
        >
          <div className="flex h-tab shrink-0 items-center gap-1 border-b border-border px-1.5">
            <span className="shrink-0 text-2xs uppercase tracking-wide text-muted-foreground">{t('side.title')}</span>
            <div className="wb-scroll flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
              {sides.map((id, index) => (
                <span
                  key={id}
                  className={cn(
                    'flex items-center gap-1 rounded px-1.5 py-0.5 text-xs',
                    side === id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <button type="button" onClick={() => setSide(id)} className="whitespace-nowrap">
                    {`${t('side.item')} ${index + 1}`}
                  </button>
                  <button
                    type="button"
                    aria-label={t('side.closeItem')}
                    className="grid h-3 w-3 shrink-0 place-items-center rounded hover:bg-accent"
                    onClick={() => closeSide(id)}
                  >
                    <X className="h-2.5 w-2.5" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon"
              title={t('side.new')}
              disabled={busy || forkSession === undefined}
              onClick={() => void openSide()}
            >
              <Plus className="h-3 w-3" aria-hidden />
            </Button>
            <Button variant="ghost" size="icon" title={t('side.hide')} onClick={() => setDock(false)}>
              <X className="h-3 w-3" aria-hidden />
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            {side !== undefined ? (
              <Guarded fallback={<SessionCard sessionId={side} onOpen={() => closeSide(side)} t={t} />}>
                <EmbeddedConversation
                  key={side}
                  sessionId={side}
                  SessionProvider={SessionProvider}
                  renderSlot={renderSlot}
                  retainSession={retainSession}
                />
              </Guarded>
            ) : (
              <div className="grid h-full place-content-center gap-2 px-4 text-center text-xs text-muted-foreground">
                <span>{t('side.empty')}</span>
                {forkFailed && <span className="text-warning">{t('side.forkFailed')}</span>}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || forkSession === undefined}
                  onClick={() => void openSide()}
                >
                  {t('side.start')}
                </Button>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  )
}

function useDark(): boolean {
  const [dark, setDark] = React.useState(isDark)
  React.useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDark()))
    const options: MutationObserverInit = { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class', 'style'] }
    observer.observe(document.documentElement, options)
    /* The attribute lives on <body> in current dsh builds; both are watched. */
    observer.observe(document.body, options)
    return () => observer.disconnect()
  }, [])
  return dark
}

export function WorkbenchPanel(props: PanelProps & { registry: TabRegistry; appearance?: () => Appearance }) {
  const { t, close, useWorkspaces, remote, apps, openPanel, registry, home, addProject } = props
  const items = useWorkspaces((snapshot) => snapshot.items)
  const projects = React.useMemo(() => projectsOf(items), [items])
  const [layout, setLayout] = React.useState<Layout>(readStored)
  const [filter, setFilter] = React.useState('')
  const [quickOpen, setQuickOpen] = React.useState(false)
  const [cursor, setCursor] = React.useState<{ line: number; col: number } | null>(null)
  const [sidebarNote, setSidebarNote] = React.useState('')
  const dragIndex = React.useRef<number | null>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)
  /* R1.1 / P5: a narrow panel collapses its own sidebar to the 52px rail. The
     stored preference is untouched, so widening the window restores it. */
  const [narrow, setNarrow] = React.useState(false)
  const dark = useDark()
  /* R1.1: no double left rail while the panel is on screen. */
  React.useEffect(() => {
    props.collapseHostSidebar?.()
    return () => props.restoreHostSidebar?.()
  }, [props.collapseHostSidebar, props.restoreHostSidebar])

  React.useEffect(() => {
    const element = rootRef.current
    if (element === null) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setNarrow(width > 0 && width < 820)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  /* R10: font settings apply as CSS variables on the panel root only. */
  const appearance = props.appearance?.()
  const rootStyle = React.useMemo(() => {
    const style: Record<string, string> = {}
    if (appearance === undefined) return style
    if (appearance.uiFamily !== '') style['--wb-font-ui'] = appearance.uiFamily
    if (appearance.uiSize > 0) style['--wb-font-ui-size'] = `${appearance.uiSize}px`
    if (appearance.codeFamily !== '') style['--wb-font-code'] = appearance.codeFamily
    if (appearance.codeSize > 0) style['--wb-font-code-size'] = `${appearance.codeSize}px`
    if (appearance.codeLineHeight > 0) style['--wb-code-line-height'] = String(appearance.codeLineHeight)
    return style
  }, [appearance])

  React.useEffect(() => {
    setLayout((prev) => {
      let next = prev
      for (const project of projects) next = ensureProject(next, project.id)
      if (next.activeProjectId === null && projects[0] !== undefined) next = setActiveProject(next, projects[0].id)
      return next === prev ? prev : next
    })
  }, [projects])

  /* The host copy is the one that survives a port change; localStorage is the
     fast path used while (and if) the host is unreachable. */
  const latestLayout = React.useRef<{ payload: string; updatedAt: number } | null>(null)

  React.useEffect(() => {
    const payload = serializeLayout(layout)
    const updatedAt = Date.now()
    latestLayout.current = { payload, updatedAt }
    try {
      window.localStorage.setItem(STORE_KEY, payload)
      window.localStorage.setItem(STORE_STAMP, String(updatedAt))
    } catch {
      /* private mode: keep the in-memory layout */
    }
    const timer = window.setTimeout(() => {
      void call('layout.set', { payload, updatedAt }).catch(() => undefined)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [layout])

  /* Leaving the page must not lose the last 400ms of changes. */
  React.useEffect(() => {
    const flush = () => {
      const doc = latestLayout.current
      if (doc === null) return
      void call('layout.set', doc).catch(() => undefined)
    }
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [])

  const resetLayout = () => {
    if (!window.confirm(t('tabs.resetLayoutConfirm'))) return
    const empty = serializeLayout(parseLayout(null))
    try {
      window.localStorage.setItem(STORE_KEY, empty)
      window.localStorage.setItem(STORE_STAMP, String(Date.now()))
    } catch {
      /* ignore */
    }
    void call('layout.set', { payload: empty, updatedAt: Date.now() }).catch(() => undefined)
    setLayout(parseLayout(null))
  }

  /* Restore before the first paint matters: adopt the host copy only when it is
     newer than what localStorage already holds. */
  React.useEffect(() => {
    let cancelled = false
    void call('layout.get', {})
      .catch(() => null)
      .then((remote) => {
        if (cancelled) return
        const doc = remote as { payload?: unknown; updatedAt?: unknown } | null
        if (doc === null || typeof doc.payload !== 'string' || typeof doc.updatedAt !== 'number') return
        const local = Number(window.localStorage.getItem(STORE_STAMP) ?? 0)
        if (!(doc.updatedAt > local)) return
        try {
          window.localStorage.setItem(STORE_KEY, doc.payload)
          window.localStorage.setItem(STORE_STAMP, String(doc.updatedAt))
        } catch {
          /* ignore */
        }
        setLayout(parseLayout(doc.payload))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const activeProjectId = layout.activeProjectId ?? projects[0]?.id ?? null
  const project = projects.find((item) => item.id === activeProjectId)
  /* R2.8: branch + change count for the status bar and the git tab badge. */
  const git = useGitSummary(project?.path)
  const state: ProjectTabs =
    activeProjectId === null
      ? { tabs: [], activeTabId: null, closed: [], sidebar: { width: SIDEBAR_WIDTH.default, collapsed: false }, split: null }
      : projectState(layout, activeProjectId)
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId)

  /* Note save state rides out of the editor through the notes store (R3.6). */
  const [noteState, setNoteState] = React.useState<string>('')
  React.useEffect(() => {
    if (activeTab?.kind !== 'note') return undefined
    setNoteState(noteStatusOf(activeTab.contentId))
    return subscribeNoteStatus(() => setNoteState(noteStatusOf(activeTab.contentId)))
  }, [activeTab?.kind, activeTab?.contentId])

  const open = React.useCallback(
    (input: { kind: TabKind; contentId: string; title: string; params?: Record<string, unknown> }) => {
      if (activeProjectId !== null) setLayout((prev) => openTab(prev, activeProjectId, input))
    },
    [activeProjectId],
  )
  const openFile = React.useCallback(
    (path: string, line?: number, name?: string) =>
      open({
        kind: 'file',
        contentId: path,
        title: name ?? path.split('/').pop() ?? path,
        /* `stamp` makes a repeat click on the same hit reveal the line again. */
        params: line === undefined ? undefined : { line, stamp: Date.now() },
      }),
    [open],
  )

  /** Retitle the current tab in place (v0.3: a note's frontmatter owns its name). */
  const retitle = React.useCallback(
    (title: string) => {
      const trimmed = title.trim()
      if (activeProjectId === null || activeTab === undefined || trimmed === '' || trimmed === activeTab.title) return
      setLayout((prev) => {
        const current = prev.projects[activeProjectId]
        if (current === undefined) return prev
        return {
          ...prev,
          projects: {
            ...prev.projects,
            [activeProjectId]: {
              ...current,
              tabs: current.tabs.map((tab) => (tab.id === activeTab.id ? { ...tab, title: trimmed } : tab)),
            },
          },
        }
      })
    },
    [activeProjectId, activeTab],
  )

  /** Closing a terminal tab ends its process (R1.13). */
  const selectTab = (id: string) => {
    if (activeProjectId === null) return
    setLayout((prev) => ({
      ...prev,
      projects: { ...prev.projects, [activeProjectId]: { ...projectState(prev, activeProjectId), activeTabId: id } },
    }))
  }

  /* T5: rename, per-tab menu, drag hint, batch close, keyboard reorder. */
  const [renaming, setRenaming] = React.useState<{ id: string; value: string } | null>(null)
  const [menuFor, setMenuFor] = React.useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [dropHint, setDropHint] = React.useState<{ id: string; side: 'left' | 'right' } | null>(null)
  const [toast, setToast] = React.useState('')
  const stripRef = React.useRef<HTMLDivElement | null>(null)
  const toastTimer = React.useRef<number | null>(null)

  const notify = (message: string) => {
    setToast(message)
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 1800)
  }

  const startRename = (tab: TabModel) => setRenaming({ id: tab.id, value: displayTitle(tab) })

  const commitRename = (id: string, value: string) => {
    if (activeProjectId !== null) setLayout((prev) => renameTab(prev, activeProjectId, id, value))
    setRenaming(null)
  }

  const closeOne = React.useCallback(
    (id: string, options?: { force?: boolean }) => {
      if (activeProjectId === null) return
      const tab = projectState(layout, activeProjectId).tabs.find((candidate) => candidate.id === id)
      /* R3.7: an unsaved note asks before the tab (and its text) goes away. A
         batch close already asked once for the whole group (`force`). */
      if (
        tab?.kind === 'note' &&
        isNoteDirty(tab.contentId) &&
        options?.force !== true &&
        !window.confirm(t('notes.closeDirty'))
      ) {
        return
      }
      const sessionId = project?.sessionIds[0]
      if (tab?.kind === 'terminal' && sessionId !== undefined) closeTerminalModel(`${sessionId}:${id}`)
      setLayout((prev) => closeTab(prev, activeProjectId, id))
    },
    [activeProjectId, layout, project?.sessionIds, t],
  )

  /** One confirmation for the whole group, then close one by one (R3). */
  const closeMany = (ids: string[]) => {
    const targets = ids
      .map((id) => state.tabs.find((tab) => tab.id === id))
      .filter((tab): tab is TabModel => tab !== undefined)
    if (targets.length === 0) return
    if (targets.length > 1) {
      const titles = targets.map((tab) => displayTitle(tab)).join('、')
      const dirty = targets.filter((tab) => tab.kind === 'note' && isNoteDirty(tab.contentId)).length
      const message = (
        dirty > 0 ? t('tabs.closeManyDirty') : t('tabs.closeMany')
      )
        .replace('{count}', String(targets.length))
        .replace('{dirty}', String(dirty))
        .replace('{titles}', titles)
      if (!window.confirm(message)) return
    }
    for (const tab of targets) closeOne(tab.id, { force: true })
  }

  const copyPath = async (tab: TabModel) => {
    try {
      await navigator.clipboard.writeText(tab.contentId)
      notify(t('tabs.pathCopied'))
    } catch {
      notify(t('tabs.pathCopyFailed'))
    }
  }

  /* ⌥⌘← / ⌥⌘→ reorder, ← / → move focus, F2 rename, Shift+F10 menu (R4/R5). */
  const onStripKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (renaming !== null || activeProjectId === null) return
    const tabs = state.tabs.filter((tab) => tab.pane !== 'secondary')
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const step = event.key === 'ArrowLeft' ? -1 : 1
      if ((event.altKey && (event.metaKey || event.ctrlKey)) && state.activeTabId !== null) {
        event.preventDefault()
        setLayout((prev) => shiftTab(prev, activeProjectId, state.activeTabId!, step === -1 ? -1 : 1))
        return
      }
      if (event.altKey || event.metaKey || event.ctrlKey) return
      event.preventDefault()
      const index = tabs.findIndex((tab) => tab.id === state.activeTabId)
      const next = tabs[Math.min(tabs.length - 1, Math.max(0, index + step))]
      if (next !== undefined) {
        selectTab(next.id)
        stripRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(next.id)}"]`)?.focus()
      }
      return
    }
    if (event.key === 'F2' && state.activeTabId !== null) {
      event.preventDefault()
      const tab = tabs.find((candidate) => candidate.id === state.activeTabId)
      if (tab !== undefined) startRename(tab)
      return
    }
    if (event.key === 'F10' && event.shiftKey && state.activeTabId !== null) {
      event.preventDefault()
      const rect = stripRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(state.activeTabId)}"]`)?.getBoundingClientRect()
      setMenuAnchor({ x: rect?.left ?? 0, y: rect?.bottom ?? 0 })
      setMenuFor(state.activeTabId)
    }
  }


  const cycleTab = (delta: number) => {
    if (activeProjectId === null || state.tabs.length < 2) return
    const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId)
    const next = state.tabs[(index + delta + state.tabs.length) % state.tabs.length]!
    selectTab(next.id)
  }

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      /* R1.14: a focused editor or terminal owns its keys; the shell stays out. */
      if (
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'p' && !event.shiftKey) {
        event.preventDefault()
        setQuickOpen(true)
      } else if (key === 'f' && event.shiftKey) {
        event.preventDefault()
        open({ kind: 'search', contentId: 'search', title: t('tab.search') })
      } else if (key === 'n' && event.shiftKey) {
        event.preventDefault()
        const sessionId = project?.sessionIds[0]
        if (sessionId !== undefined) open({ kind: 'session', contentId: sessionId, title: t('tab.session') })
      } else if (key === 'w' && activeTab !== undefined) {
        event.preventDefault()
        closeOne(activeTab.id)
      } else if (key === 'b' && activeProjectId !== null) {
        event.preventDefault()
        setLayout((prev) => setSidebar(prev, activeProjectId, { collapsed: !projectState(prev, activeProjectId).sidebar.collapsed }))
      } else if (key === 't' && event.shiftKey) {
        event.preventDefault()
        if (activeProjectId !== null) setLayout((prev) => reopenLast(prev, activeProjectId))
      } else if (event.key === 'Tab') {
        event.preventDefault()
        cycleTab(event.shiftKey ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeProjectId, activeTab, close, closeOne, open, project?.sessionIds, state.tabs, state.activeTabId, t])

  const newTabItems: { kind: TabKind | 'openFile' | 'newProject'; label: string; hint?: string; icon: React.ReactNode }[] = [
    { kind: 'session', label: t('tab.session'), hint: '⌘⇧N', icon: <KindIcon kind="session" /> },
    { kind: 'openFile', label: t('menu.openFile'), hint: '⌘P', icon: <KindIcon kind="file" /> },
    { kind: 'explorer', label: t('tab.explorer'), icon: <KindIcon kind="explorer" /> },
    { kind: 'search', label: t('tab.search'), hint: '⌘⇧F', icon: <KindIcon kind="search" /> },
    { kind: 'terminal', label: t('tab.terminal'), icon: <KindIcon kind="terminal" /> },
    { kind: 'git', label: t('tab.git'), icon: <KindIcon kind="git" /> },
    { kind: 'notes', label: t('tab.notes'), icon: <KindIcon kind="notes" /> },
  ]

  /**
   * New session tab (v0.3): ask the host to start/reuse a blank Session in this
   * workspace, then show that exact id. It appears in the default page's session
   * list too — one Session, two views (research/session-tabs.md).
   */
  const openNewSession = React.useCallback(async () => {
    const workspaceId = activeProjectId
    if (workspaceId === null) return
    if (props.newSession === undefined) {
      setSidebarNote(t('session.newUnavailable'))
      return
    }
    const sessionId = await props.newSession(workspaceId)
    if (sessionId === undefined) {
      setSidebarNote(t('session.newUnavailable'))
      return
    }
    setSidebarNote('')
    open({ kind: 'session', contentId: sessionId, title: t('tab.session') })
  }, [activeProjectId, open, props.newSession, t])

  const createTab = (kind: TabKind | 'openFile' | 'newProject') => {
    if (kind === 'openFile') {
      /* The quick-open palette is the real picker; a typed absolute path was a
         dead end (no completion, no error, and it looked broken). */
      setQuickOpen(true)
      return
    }
    if (kind === 'newProject') {
      void addProjectFromPrompt()
      return
    }
    if (kind === 'terminal') {
      const sessionId = project?.sessionIds[0]
      if (sessionId === undefined) return
      const contentId = `term-${Date.now().toString(36)}`
      open({ kind: 'terminal', contentId, title: t('tab.terminal') })
      return
    }
    if (kind === 'session') {
      void openNewSession()
      return
    }
    if (kind === 'notes') {
      open({ kind: 'notes', contentId: 'notes', title: t('tab.notes') })
      return
    }
    if (kind === 'note') {
      // New note: the host owns the file, the client owns the locale.
      void call<{ path: string; title: string }>('notes.create', { title: t('notes.untitledNew') }).then(
        (created) => open({ kind: 'note', contentId: created.path, title: created.title }),
        (error: Error) => setSidebarNote(error.message),
      )
      return
    }
    open({ kind, contentId: kind, title: t(`tab.${kind}`) })
  }

  const addProjectFromPrompt = async () => {
    setSidebarNote('')
    /* Native picker first; a host without one falls back to typing a path. */
    let path: string | null = props.pickDirectory === undefined ? null : await props.pickDirectory()
    if (path === null) {
      const typed = window.prompt(t('sidebar.addProjectPrompt'))
      path = typed === null || typed.trim() === '' ? null : typed.trim()
    }
    if (path === null) return
    try {
      if (addProject === undefined) throw new Error(t('sidebar.addProjectUnavailable'))
      const created = await addProject(path)
      if (created !== undefined) setLayout((prev) => setActiveProject(prev, created))
    } catch (error) {
      setSidebarNote((error as Error).message)
    }
  }

  const visibleProjects = projects.filter((item) => filter === '' || item.title.toLowerCase().includes(filter.toLowerCase()))
  const rail = state.sidebar.collapsed || narrow
  const sidebarWidth = rail ? SIDEBAR_WIDTH.collapsed : state.sidebar.width

  const sidebar = (
    <aside className="relative flex shrink-0 flex-col border-r border-border bg-[var(--sidebar-bg)]" style={{ width: sidebarWidth }}>
      {rail ? (
        <div className="flex flex-col items-center gap-1 py-2">
          <Button variant="ghost" size="icon" title={t('panel.back')} onClick={close}>
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          </Button>
          {activeProjectId !== null && (
            <Button
              variant="ghost"
              size="icon"
              title={t('sidebar.expand')}
              onClick={() => setLayout((prev) => setSidebar(prev, activeProjectId, { collapsed: false }))}
            >
              <ChevronsRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
          <DropdownMenuSeparator className="mx-2 my-1 w-6" />
          {visibleProjects.map((item) => (
            <button
              key={item.id}
              type="button"
              title={item.title}
              onClick={() => setLayout((prev) => setActiveProject(prev, item.id))}
              className={cn(
                'grid h-8 w-8 place-items-center rounded-md text-xs font-semibold text-muted-foreground hover:bg-accent',
                item.id === activeProjectId && 'bg-background text-foreground shadow-[inset_0_0_0_1px_var(--border)]',
              )}
            >
              {item.title.slice(0, 1).toUpperCase()}
            </button>
          ))}
          <span className="flex-1" />
          <Button variant="ghost" size="icon" title={t('sidebar.addProject')} onClick={() => void addProjectFromPrompt()}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex h-tab items-center gap-1 px-2">
            <Button variant="ghost" size="icon" title={t('panel.back')} onClick={close}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t('sidebar.projects')}</span>
            <span className="flex-1" />
            <Button variant="ghost" size="icon" title={t('sidebar.addProject')} onClick={() => void addProjectFromPrompt()}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </Button>
            {activeProjectId !== null && !narrow && (
              <Button
                variant="ghost"
                size="icon"
                title={t('sidebar.collapse')}
                onClick={() => setLayout((prev) => setSidebar(prev, activeProjectId, { collapsed: true }))}
              >
                <ChevronsLeft className="h-3.5 w-3.5" aria-hidden />
              </Button>
            )}
          </div>
          <div className="px-3 pb-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-faint" aria-hidden />
              <Input className="pl-7" placeholder={t('sidebar.filter')} value={filter} onChange={(event) => setFilter(event.target.value)} />
            </div>
            {sidebarNote !== '' && <div className="mt-1 text-2xs text-destructive">{sidebarNote}</div>}
          </div>
          <div className="wb-scroll flex-1 overflow-auto px-1.5">
            {visibleProjects.map((item) => {
              const itemTabs = projectState(layout, item.id).tabs
              const activeRow = item.id === activeProjectId
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setLayout((prev) => setActiveProject(prev, item.id))}
                  className={cn(
                    'relative flex w-full items-center gap-2 rounded-md border-l-2 border-transparent px-2 py-[7px] text-left hover:bg-accent',
                    activeRow && 'border-l-primary bg-accent',
                  )}
                >
                  <span
                    className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-[5px]', activeRow ? 'wb-proj-icon' : 'bg-muted text-muted-foreground')}
                  >
                    <Folder className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
                    </span>
                    <span className="block truncate text-2xs leading-4 text-muted-foreground">{shortPath(item.path, home)}</span>
                  </span>
                  <span className="shrink-0 self-start pt-0.5">
                    {item.running ? (
                      <span className="flex items-center gap-1 text-2xs text-[#1A7F37]">
                        <Circle className="h-1.5 w-1.5 fill-current" aria-hidden />
                        {t('sidebar.running')}
                      </span>
                    ) : (
                      <span
                        className={cn(
                          'flex items-center gap-1 rounded-full px-1.5 text-2xs',
                          activeRow ? 'bg-background text-foreground shadow-[inset_0_0_0_1px_var(--border)]' : 'text-muted-foreground',
                        )}
                      >
                        <Circle className={cn('h-1.5 w-1.5', activeRow ? 'fill-primary text-primary' : 'fill-current')} aria-hidden />
                        {itemTabs.length === 0 ? '' : `${itemTabs.length} ${t(itemTabs.length === 1 ? 'sidebar.tabOne' : 'sidebar.tabMany')}`}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="border-t border-border">
            <button
              type="button"
              onClick={() => void addProjectFromPrompt()}
              className="flex h-[30px] w-full items-center gap-2 px-3 text-xs text-muted-foreground hover:bg-accent"
            >
              <FolderPlus className="h-3.5 w-3.5" aria-hidden />
              {t('sidebar.addProject')}
            </button>
            {apps !== undefined && apps.length > 0 && (
              <div className="border-t border-border py-1">
                <div className="px-3 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {t('sidebar.apps')}
                </div>
                {apps.map((app) => (
                  <button
                    key={app.key}
                    type="button"
                    onClick={() => openPanel?.(app.key)}
                    className="flex h-[26px] w-full items-center gap-2 px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Box className="h-3.5 w-3.5" aria-hidden />
                    <span className="truncate">{app.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {activeProjectId !== null && (
            <div
              className="wb-resize absolute -right-0.5 top-0 h-full w-1 cursor-col-resize"
              onDoubleClick={() => setLayout((prev) => setSidebar(prev, activeProjectId, { width: SIDEBAR_WIDTH.default }))}
              onMouseDown={(down) => {
                const startX = down.clientX
                const startWidth = state.sidebar.width
                const move = (event: MouseEvent) =>
                  setLayout((prev) => setSidebar(prev, activeProjectId, { width: startWidth + event.clientX - startX }))
                const up = () => {
                  window.removeEventListener('mousemove', move)
                  window.removeEventListener('mouseup', up)
                }
                window.addEventListener('mousemove', move)
                window.addEventListener('mouseup', up)
              }}
            />
          )}
        </>
      )}
    </aside>
  )

  const tabStrip = (
    <div className="flex h-tab shrink-0 items-stretch border-b border-border bg-[var(--tabstrip-bg)]" role="tablist">
      <div ref={stripRef} onKeyDown={onStripKeyDown} className="wb-scroll flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {state.tabs.filter((tab) => tab.pane !== 'secondary').map((tab) => {
          const active = tab.id === state.activeTabId
          const icon = registry.get(tab.kind)?.icon
          const left = activeProjectId === null ? [] : tabsLeftOf(layout, activeProjectId, tab.id)
          const right = activeProjectId === null ? [] : tabsRightOf(layout, activeProjectId, tab.id)
          const pathLike = tab.kind === 'file' || tab.kind === 'note' || tab.kind === 'explorer'
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              data-tab-id={tab.id}
              tabIndex={active ? 0 : -1}
              draggable={renaming?.id !== tab.id}
              onContextMenu={(event) => {
                event.preventDefault()
                setMenuAnchor({ x: event.clientX, y: event.clientY })
                setMenuFor(tab.id)
              }}
              onDoubleClick={() => startRename(tab)}
              onDragStart={() => (dragIndex.current = state.tabs.findIndex((candidate) => candidate.id === tab.id))}
              onDragOver={(event) => {
                event.preventDefault()
                const rect = event.currentTarget.getBoundingClientRect()
                setDropHint({ id: tab.id, side: event.clientX < rect.left + rect.width / 2 ? 'left' : 'right' })
                const strip = stripRef.current
                if (strip !== null) {
                  const box = strip.getBoundingClientRect()
                  if (event.clientX - box.left < 24) strip.scrollLeft -= 12
                  else if (box.right - event.clientX < 24) strip.scrollLeft += 12
                }
              }}
              onDragEnd={() => setDropHint(null)}
              onDrop={(event) => {
                event.preventDefault()
                setDropHint(null)
                if (dragIndex.current !== null && activeProjectId !== null) {
                  const from = dragIndex.current
                  setLayout((prev) => moveTab(prev, activeProjectId, from, state.tabs.findIndex((candidate) => candidate.id === tab.id)))
                }
                dragIndex.current = null
              }}
              onClick={() => selectTab(tab.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') selectTab(tab.id)
              }}
              onAuxClick={(event) => {
                if (event.button === 1) closeOne(tab.id)
              }}
              className={cn(
                'group relative flex min-w-[104px] max-w-[200px] cursor-pointer items-center gap-1.5 whitespace-nowrap border-r border-border px-2.5 text-xs',
                active
                  ? 'bg-[var(--background)] text-foreground shadow-[inset_0_2px_0_0_var(--accent),inset_0_-1px_0_0_var(--background)]'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {icon ?? <KindIcon kind={tab.kind} />}
              {renaming !== null && renaming.id === tab.id ? (
                <input
                  aria-label={t('tabs.renameLabel')}
                  autoFocus
                  value={renaming.value}
                  className="w-full min-w-0 rounded-sm bg-[var(--background)] px-0.5 text-xs text-foreground outline-none ring-1 ring-primary"
                  onChange={(event) => setRenaming({ id: tab.id, value: event.target.value })}
                  onFocus={(event) => event.target.select()}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onBlur={() => commitRename(tab.id, renaming.value)}
                  onKeyDown={(event) => {
                    /* The panel's own shortcuts must not fire while typing (R7). */
                    event.stopPropagation()
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitRename(tab.id, renaming.value)
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      setRenaming(null)
                    }
                  }}
                />
              ) : (
                <span className="truncate">{displayTitle(tab)}</span>
              )}
              {tab.kind === 'git' && git !== null && git.changes > 0 && (
                <span className="wb-badge rounded-full px-1 text-2xs leading-4">{git.changes}</span>
              )}
              <button
                type="button"
                aria-label={t('tabs.close')}
                className={cn(
                  'ml-auto grid h-3.5 w-3.5 shrink-0 place-items-center rounded hover:bg-accent',
                  active ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-70',
                )}
                onClick={(event) => {
                  event.stopPropagation()
                  closeOne(tab.id)
                }}
              >
                <X className="h-2.5 w-2.5" aria-hidden />
              </button>
              {dropHint?.id === tab.id && (
                <span
                  aria-hidden
                  className={cn('pointer-events-none absolute top-0 h-full w-0.5 bg-primary', dropHint.side === 'left' ? 'left-0' : 'right-0')}
                />
              )}
              {menuFor === tab.id && (
                <DropdownMenu open onOpenChange={(open) => (open ? undefined : setMenuFor(null))}>
                  <DropdownMenuTrigger asChild>
                    <span aria-hidden className="pointer-events-none fixed h-0 w-0" style={{ left: menuAnchor.x, top: menuAnchor.y }} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-[220px]">
                    <DropdownMenuItem onSelect={() => startRename(tab)}>{t('tabs.rename')}</DropdownMenuItem>
                    {tab.titleOverride !== undefined && (
                      <DropdownMenuItem onSelect={() => activeProjectId !== null && commitRename(tab.id, '')}>
                        {t('tabs.renameReset')}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => closeOne(tab.id)}>{t('tabs.closeOne')}</DropdownMenuItem>
                    <DropdownMenuItem disabled={state.tabs.length < 2} onSelect={() => closeMany(state.tabs.filter((item) => item.id !== tab.id).map((item) => item.id))}>
                      {t('tabs.closeOthers')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={left.length === 0}
                      onSelect={() => closeMany(left)}
                    >
                      {left.length > 1 ? t('tabs.closeLeftN').replace('{count}', String(left.length)) : t('tabs.closeLeft')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={right.length === 0}
                      onSelect={() => closeMany(right)}
                    >
                      {right.length > 1 ? t('tabs.closeRightN').replace('{count}', String(right.length)) : t('tabs.closeRight')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => closeMany(state.tabs.map((item) => item.id))}>{t('tabs.closeAll')}</DropdownMenuItem>
                    {pathLike && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => void copyPath(tab)}>{t('tabs.copyPath')}</DropdownMenuItem>
                        {tab.kind === 'file' && project !== undefined && (
                          <DropdownMenuItem
                            onSelect={() =>
                              void call('path.reveal', { path: `${project.path}/${tab.contentId}` }).catch(() => undefined)
                            }
                          >
                            {t('tabs.reveal')}
                          </DropdownMenuItem>
                        )}
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => activeProjectId !== null && setLayout((prev) => reopenLast(prev, activeProjectId))}>
                      {t('tabs.reopen')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 px-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" title={t('tabs.new')}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[248px]">
            <div className="px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t('tabs.newHeader')}
            </div>
            {newTabItems.map((item, index) => (
              <React.Fragment key={item.kind}>
                {index === 7 && <DropdownMenuSeparator />}
                <DropdownMenuItem icon={item.icon} onSelect={() => createTab(item.kind)}>
                  <span className="flex-1">{item.label}</span>
                  {item.hint !== undefined && <span className="pl-4 text-2xs text-muted-foreground">{item.hint}</span>}
                </DropdownMenuItem>
              </React.Fragment>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<KindIcon kind="note" />} onSelect={() => createTab('note')}>
              <span className="flex-1">{t('menu.newNote')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem icon={<FolderPlus className="h-3 w-3" />} onSelect={() => createTab('newProject')}>
              <span className="flex-1">{t('menu.newProject')}</span>
            </DropdownMenuItem>
            {project !== undefined && project.sessionIds.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled className="text-faint">
                  {t('session.history')}
                </DropdownMenuItem>
                {project.sessionIds.slice(0, 12).map((sessionId) => (
                  <DropdownMenuItem
                    key={sessionId}
                    icon={<KindIcon kind="session" />}
                    onSelect={() => open({ kind: 'session', contentId: sessionId, title: t('tab.session') })}
                  >
                    <span className="truncate">{`${t('tab.session')} · ${sessionId.replace(/^session-/, '').slice(0, 8)}`}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" title={t('tabs.more')}>
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => activeProjectId !== null && setLayout((prev) => reopenLast(prev, activeProjectId))}>
              {t('tabs.reopen')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={state.split !== null}
              onSelect={() => activeProjectId !== null && setLayout((prev) => splitActive(prev, activeProjectId, 'row'))}
            >
              {t('tabs.splitRow')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={state.split !== null}
              onSelect={() => activeProjectId !== null && setLayout((prev) => splitActive(prev, activeProjectId, 'col'))}
            >
              {t('tabs.splitCol')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={activeTab === undefined}
              onSelect={() => activeProjectId !== null && activeTab !== undefined && setLayout((prev) => togglePane(prev, activeProjectId, activeTab.id))}
            >
              {t('tabs.movePane')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={state.split === null}
              onSelect={() => activeProjectId !== null && setLayout((prev) => unsplit(prev, activeProjectId))}
            >
              {t('tabs.unsplit')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={state.tabs.length < 2}
              onSelect={() => closeMany(state.tabs.filter((tab) => tab.id !== activeTab?.id).map((tab) => tab.id))}
            >
              {t('tabs.closeOthers')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => closeMany(state.tabs.map((tab) => tab.id))}>{t('tabs.closeAll')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={resetLayout}>{t('tabs.resetLayout')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )

  const fileSegments = activeTab?.kind === 'file' ? activeTab.contentId.split('/') : []
  const noteSegments = activeTab?.kind === 'note' ? [`~/.dsh/notes`, displayTitle(activeTab)] : []
  const segments = fileSegments.length > 0 ? fileSegments : noteSegments
  const crumbMeta =
    activeTab === undefined
      ? ''
      : activeTab.kind === 'note'
        ? noteState === ''
          ? ''
          : t(`notes.status.${noteState}`)
        : activeTab.kind === 'git'
          ? git !== null
            ? `${git.branch}${git.changes > 0 ? ` · ±${git.changes}` : ''}`
            : ''
          : activeTab.kind === 'file'
            ? languageLabel(activeTab.contentId)
            : ''
  const breadcrumb = (
    <div className="flex h-crumb shrink-0 items-center gap-1.5 overflow-hidden border-b border-border bg-[var(--background)] px-3 text-xs text-muted-foreground">
      {segments.length === 0 ? (
        <span className="flex items-center gap-1.5">
          <Folder className="h-3 w-3" aria-hidden />
          {activeTab === undefined ? t('panel.title') : displayTitle(activeTab)}
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-1">
          <Folder className="h-3 w-3 shrink-0" aria-hidden />
          {segments.map((segment, index) => (
            <React.Fragment key={`${segment}:${index}`}>
              {index > 0 && <span className="text-faint">›</span>}
              <span className={cn('truncate', index === segments.length - 1 && 'text-foreground')}>{segment}</span>
            </React.Fragment>
          ))}
        </span>
      )}
      <span className="ml-auto shrink-0 text-2xs text-muted-foreground">{crumbMeta}</span>
    </div>
  )

  /* One renderer for both panes (v0.3 split): the same branches, keyed on `tab`. */
  const bodyFor = (tab: TabModel | undefined): React.ReactNode => {
  if (tab === undefined) {
    return (
      <div className="grid h-full place-content-center gap-2 px-6 text-center text-muted-foreground">
        <strong className="text-sm text-foreground">{t('empty.title')}</strong>
        <span className="text-xs">{t('empty.hint')}</span>
      </div>
    )
  } else if (remote === undefined) {
    return <div className="p-3 text-xs text-muted-foreground">{t('panel.noBridge')}</div>
  } else if (tab.kind === 'file') {
    const line = typeof tab.params?.line === 'number' ? (tab.params.line as number) : undefined
    const stamp = typeof tab.params?.stamp === 'number' ? (tab.params.stamp as number) : undefined
    const markdown = /\.mdx?$/i.test(tab.contentId)
    return markdown ? (
      <MarkdownView
        path={tab.contentId}
        sessionId={project?.sessionIds[0]}
        remote={remote}
        t={t}
        line={line}
        stamp={stamp}
        scrollKey={tab.id}
      />
    ) : (
      <FileView
        path={tab.contentId}
        sessionId={project?.sessionIds[0]}
        remote={remote}
        t={t}
        line={line}
        stamp={stamp}
        onCursor={setCursor}
        root={project?.path}
      />
    )
  } else if (tab.kind === 'explorer') {
    return (
      <ExplorerView
        root={project?.path ?? ''}
        sessionId={project?.sessionIds[0]}
        remote={remote}
        onOpen={(path, name) => openFile(path, undefined, name)}
        t={t}
      />
    )
  } else if (tab.kind === 'terminal') {
    const sessionId = project?.sessionIds[0]
    return (
      sessionId !== undefined && props.terminal !== undefined ? (
        <TerminalTab
          tabId={tab.id}
          contentId={tab.contentId}
          sessionId={sessionId}
          openModel={props.terminal}
          t={t}
        />
      ) : (
        <div className="grid h-full place-content-center text-xs text-muted-foreground">{t('terminal.unavailable')}</div>
      )
    )
  } else if (tab.kind === 'session') {
    return (
      (props as any).SessionProvider !== undefined && (props as any).renderSlot !== undefined && props.retainSession !== undefined ? (
        <Guarded fallback={<SessionCard sessionId={tab.contentId} onOpen={close} t={t} />}>
          <SessionTabView
            sessionId={tab.contentId}
            SessionProvider={(props as any).SessionProvider}
            renderSlot={(props as any).renderSlot}
            retainSession={props.retainSession}
            retitle={retitle}
            forkSession={props.forkSession}
            t={t}
          />
        </Guarded>
      ) : (
        <SessionCard sessionId={tab.contentId} onOpen={close} t={t} />
      )
    )
  } else if (tab.kind === 'search') {
    return (
      <SearchView
        root={project?.path ?? ''}
        sessionId={project?.sessionIds[0]}
        remote={remote}
        autoFocus
        onOpen={(path, line) => openFile(path, line)}
        t={t}
      />
    )
  } else if (registry.get(tab.kind)?.render !== undefined) {
    return (
      <Guarded
        fallback={
          <div className="grid h-full place-content-center gap-1 text-center text-xs text-muted-foreground">
            <strong className="text-sm text-foreground">{tab.title}</strong>
            <span>{t('common.crashed')}</span>
          </div>
        }
      >
        {registry.get(tab.kind)!.render!({
          tab: tab,
          t,
          project,
          sessionId: project?.sessionIds[0],
          open,
          openFile,
          retitle,
          projects: projects.map((item) => ({ path: item.path, title: item.title })),
        })}
      </Guarded>
    )
  } else {
    return (
      <div className="grid h-full place-content-center gap-2 text-center text-muted-foreground">
        <strong className="text-sm text-foreground">{tab.title}</strong>
        <span className="text-xs">{t('common.notYet')}</span>
      </div>
    )
  }
    return null
  }

  const content = bodyFor(activeTab)
  const splitTab = state.split === null ? undefined : state.tabs.find((tab) => tab.id === state.split!.activeTabId)

  const isFileTab = activeTab?.kind === 'file'
  const statusBar = (
    <div className="flex h-status shrink-0 items-center gap-3 border-t border-border bg-[var(--card)] px-3 text-2xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Folder className="h-3 w-3" aria-hidden />
        <span className="max-w-[180px] truncate text-foreground">{project?.title ?? ''}</span>
      </span>
      {git !== null && git.branch !== '' && (
        <button
          type="button"
          className="flex items-center gap-1 rounded px-0.5 hover:text-foreground"
          title={t('status.git')}
          onClick={() => open({ kind: 'git', contentId: 'git', title: t('tab.git') })}
        >
          <GitBranch className="h-3 w-3" aria-hidden />
          <span className="max-w-[140px] truncate">{git.branch}</span>
          {git.ahead > 0 && <span className="text-[#1A7F37]">+{git.ahead}</span>}
          {git.behind > 0 && <span className="text-[#CF222E]">−{git.behind}</span>}
        </button>
      )}
      {state.tabs.length > 0 && (
        <span className="flex items-center gap-1">
          <Box className="h-3 w-3" aria-hidden />
          {state.tabs.length} {t('status.tabs')}
        </span>
      )}
      <span className="ml-auto flex items-center gap-3">
        {isFileTab && (
          <span>
            {t('status.cursor')
              .replace('{line}', String(cursor?.line ?? 1))
              .replace('{col}', String(cursor?.col ?? 1))}
          </span>
        )}
        {isFileTab && <span>UTF-8</span>}
        {isFileTab && activeTab !== undefined && <span>{languageLabel(activeTab.contentId)}</span>}
        <button
          type="button"
          className="flex items-center gap-1 rounded px-0.5 enabled:hover:bg-accent enabled:hover:text-foreground disabled:cursor-default"
          onClick={props.toggleTheme}
          disabled={props.toggleTheme === undefined}
          title={t('status.themeToggle')}
        >
          {dark ? <Moon className="h-3 w-3" aria-hidden /> : <Sun className="h-3 w-3" aria-hidden />}
          {dark ? t('status.dark') : t('status.light')}
        </button>
      </span>
    </div>
  )

  /* Second pane's strip (v0.3): tabs only, no + menu, one unsplit control. */
  const secondaryStrip = (
    <div className="flex h-tab shrink-0 items-stretch border-b border-border bg-[var(--tabstrip-bg)]" role="tablist">
      <div className="wb-scroll flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {state.tabs
          .filter((tab) => tab.pane === 'secondary')
          .map((tab) => {
            const active = state.split?.activeTabId === tab.id
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={active}
                tabIndex={0}
                onClick={() => activeProjectId !== null && setLayout((prev) => activateTab(prev, activeProjectId, tab.id))}
                onKeyDown={(event) => event.key === 'Enter' && activeProjectId !== null && setLayout((prev) => activateTab(prev, activeProjectId, tab.id))}
                className={cn(
                  'group flex min-w-[96px] max-w-[200px] cursor-pointer items-center gap-1.5 whitespace-nowrap border-r border-border px-2.5 text-xs',
                  active ? 'bg-[var(--background)] text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <KindIcon kind={tab.kind} />
                <span className="truncate">{displayTitle(tab)}</span>
                <button
                  type="button"
                  aria-label={t('tabs.close')}
                  className="ml-auto grid h-3.5 w-3.5 shrink-0 place-items-center rounded hover:bg-accent"
                  onClick={(event) => {
                    event.stopPropagation()
                    closeOne(tab.id)
                  }}
                >
                  <X className="h-2.5 w-2.5" aria-hidden />
                </button>
              </div>
            )
          })}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 px-1.5">
        <Button
          variant="ghost"
          size="icon"
          title={t('tabs.unsplit')}
          onClick={() => activeProjectId !== null && setLayout((prev) => unsplit(prev, activeProjectId))}
        >
          <X className="h-3 w-3" aria-hidden />
        </Button>
      </div>
    </div>
  )

  return (
    <div ref={rootRef} className="workbench-root" style={rootStyle as React.CSSProperties}>
      {quickOpen && (
        <QuickOpen
          root={project?.path ?? ''}
          t={t}
          onOpen={(path) => openFile(path)}
          onClose={() => setQuickOpen(false)}
        />
      )}
      {toast !== '' && (
        <div
          role="status"
          className="pointer-events-none fixed bottom-9 left-1/2 z-50 -translate-x-1/2 rounded-md bg-[var(--card)] px-2.5 py-1 text-xs text-foreground shadow-[0_4px_16px_rgba(0,0,0,0.18)] ring-1 ring-border"
        >
          {toast}
        </div>
      )}
      {sidebar}
      <div className="flex min-w-0 flex-1 flex-col">
        {state.split === null ? (
          <>
            {tabStrip}
            {breadcrumb}
            <div className="wb-scroll relative min-h-0 flex-1 overflow-auto bg-[var(--background)]">{content}</div>
          </>
        ) : (
          <div className={cn('flex min-h-0 flex-1', state.split.orientation === 'col' ? 'flex-col' : 'flex-row')}>
            <div className="flex min-w-0 flex-1 flex-col">
              {tabStrip}
              {breadcrumb}
              <div className="wb-scroll relative min-h-0 flex-1 overflow-auto bg-[var(--background)]">{content}</div>
            </div>
            <div
              className={cn(
                'flex min-w-0 flex-1 flex-col border-border',
                state.split.orientation === 'col' ? 'border-t' : 'border-l',
              )}
            >
              {secondaryStrip}
              <div className="wb-scroll relative min-h-0 flex-1 overflow-auto bg-[var(--background)]">{bodyFor(splitTab)}</div>
            </div>
          </div>
        )}
        {statusBar}
      </div>
    </div>
  )
}

/** Remember the panel that was on screen, for `startup: 'last'` (D10). */
export function rememberPanel(key: string | null): void {
  try {
    window.localStorage.setItem(LAST_PANEL_KEY, key ?? '')
  } catch {
    /* private mode */
  }
}

export function lastPanel(): string {
  try {
    return window.localStorage.getItem(LAST_PANEL_KEY) ?? ''
  } catch {
    return ''
  }
}
