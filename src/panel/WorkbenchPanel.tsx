import * as React from 'react'
import {
  ArrowLeft,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  FolderTree,
  GitBranch,
  Globe,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  SquareTerminal,
  StickyNote,
  X,
} from 'lucide-react'
import {
  closeTab,
  ensureProject,
  moveTab,
  openTab,
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
import { BrowserView } from './BrowserView'
import { MarkdownView } from './MarkdownView'
import { QuickOpen } from './QuickOpen'
import { SearchView } from './SearchView'
import type { PanelProps, Project } from './types'

const STORE_KEY = 'dsh-workbench:layout'

export interface TabTypeSpec {
  kind: TabKind
  order?: number
  render?: (props: { tab: TabModel }) => React.ReactNode
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

const KIND_ICON: Record<TabKind, React.ComponentType<{ className?: string }>> = {
  session: MessageSquare,
  file: FileText,
  explorer: FolderTree,
  search: Search,
  terminal: SquareTerminal,
  browser: Globe,
  git: GitBranch,
  note: StickyNote,
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
    id: String(item.workspaceId),
    title: String(item.title ?? item.path ?? ''),
    path: String(item.path ?? ''),
    sessionIds: Array.isArray(item.sessionIds) ? item.sessionIds.map(String) : [],
  }))
}

export function WorkbenchPanel(props: PanelProps & { registry: TabRegistry }) {
  const { t, close, useWorkspaces, remote, apps, openPanel, registry } = props
  const items = useWorkspaces((snapshot) => snapshot.items)
  const projects = React.useMemo(() => projectsOf(items), [items])
  const [layout, setLayout] = React.useState<Layout>(readStored)
  const [filter, setFilter] = React.useState('')
  const [quickOpen, setQuickOpen] = React.useState(false)
  const dragIndex = React.useRef<number | null>(null)

  React.useEffect(() => {
    setLayout((prev) => {
      let next = prev
      for (const project of projects) next = ensureProject(next, project.id)
      if (next.activeProjectId === null && projects[0] !== undefined) next = setActiveProject(next, projects[0].id)
      return next === prev ? prev : next
    })
  }, [projects])

  React.useEffect(() => {
    try {
      window.localStorage.setItem(STORE_KEY, serializeLayout(layout))
    } catch {
      /* private mode: keep the in-memory layout */
    }
  }, [layout])

  const activeProjectId = layout.activeProjectId ?? projects[0]?.id ?? null
  const project = projects.find((item) => item.id === activeProjectId)
  const state: ProjectTabs =
    activeProjectId === null
      ? { tabs: [], activeTabId: null, closed: [], sidebar: { width: SIDEBAR_WIDTH.default, collapsed: false } }
      : projectState(layout, activeProjectId)
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId)

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
        params: line === undefined ? undefined : { line },
      }),
    [open],
  )

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (event.key === 'Escape' && !typing) {
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
      } else if (key === 'w' && activeTab !== undefined && activeProjectId !== null) {
        event.preventDefault()
        setLayout((prev) => closeTab(prev, activeProjectId, activeTab.id))
      } else if (key === 'b' && activeProjectId !== null) {
        event.preventDefault()
        setLayout((prev) => setSidebar(prev, activeProjectId, { collapsed: !projectState(prev, activeProjectId).sidebar.collapsed }))
      } else if (key === 't' && event.shiftKey && activeProjectId !== null) {
        event.preventDefault()
        setLayout((prev) => reopenLast(prev, activeProjectId))
      } else if (event.key === 'Tab' && activeProjectId !== null && state.tabs.length > 1) {
        event.preventDefault()
        const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId)
        const next = state.tabs[(index + (event.shiftKey ? -1 : 1) + state.tabs.length) % state.tabs.length]!
        setLayout((prev) => ({
          ...prev,
          projects: { ...prev.projects, [activeProjectId]: { ...projectState(prev, activeProjectId), activeTabId: next.id } },
        }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeProjectId, activeTab, close, state.tabs, state.activeTabId])

  const selectTab = (id: string) => {
    if (activeProjectId === null) return
    setLayout((prev) => ({
      ...prev,
      projects: { ...prev.projects, [activeProjectId]: { ...projectState(prev, activeProjectId), activeTabId: id } },
    }))
  }

  const newTabItems: { kind: TabKind | 'openFile'; label: string }[] = [
    { kind: 'session', label: t('tab.session') },
    { kind: 'openFile', label: t('menu.openFile') },
    { kind: 'explorer', label: t('tab.explorer') },
    { kind: 'search', label: t('tab.search') },
    { kind: 'terminal', label: t('tab.terminal') },
    { kind: 'browser', label: t('tab.browser') },
    { kind: 'git', label: t('tab.git') },
    { kind: 'note', label: t('tab.note') },
  ]

  const createTab = (kind: TabKind | 'openFile') => {
    if (kind === 'openFile') {
      const path = window.prompt(t('menu.openFile'))
      if (path !== null && path.trim() !== '') openFile(path.trim())
      return
    }
    if (kind === 'browser') {
      open({ kind: 'browser', contentId: 'about:blank', title: t('tab.browser') })
      return
    }
    open({ kind, contentId: kind, title: t(`tab.${kind}`) })
  }

  const visibleProjects = projects.filter((item) => filter === '' || item.title.toLowerCase().includes(filter.toLowerCase()))
  const sidebarWidth = state.sidebar.collapsed ? SIDEBAR_WIDTH.collapsed : state.sidebar.width

  const sidebar = (
    <aside
      className="relative flex shrink-0 flex-col border-r border-border bg-card"
      style={{ width: sidebarWidth }}
    >
      {state.sidebar.collapsed ? (
        <div className="flex flex-col items-center gap-1.5 py-2">
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
          <DropdownMenuSeparator className="mx-2 w-6" />
          {visibleProjects.map((item) => (
            <Button
              key={item.id}
              variant={item.id === activeProjectId ? 'outline' : 'ghost'}
              size="icon"
              title={item.title}
              onClick={() => setLayout((prev) => setActiveProject(prev, item.id))}
            >
              <span className="text-2xs">{item.title.slice(0, 1).toUpperCase()}</span>
            </Button>
          ))}
        </div>
      ) : (
        <>
          <div className="flex h-tab items-center gap-1 border-b border-border px-1.5">
            <Button variant="ghost" size="icon" title={t('panel.back')} onClick={close}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            </Button>
            <span className="ml-1 text-2xs uppercase tracking-wider text-muted-foreground">{t('sidebar.projects')}</span>
            <span className="flex-1" />
            {activeProjectId !== null && (
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
          <div className="p-2">
            <Input placeholder={t('sidebar.filter')} value={filter} onChange={(event) => setFilter(event.target.value)} />
          </div>
          <div className="wb-scroll flex-1 overflow-auto">
            {visibleProjects.map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                className={cn(
                  'h-[30px] w-full justify-start gap-2 rounded-none border-l-2 border-transparent px-2.5 text-xs font-normal',
                  item.id === activeProjectId && 'border-l-primary bg-accent',
                )}
                onClick={() => setLayout((prev) => setActiveProject(prev, item.id))}
              >
                <PanelLeft className="h-3 w-3 text-muted-foreground" aria-hidden />
                <span className="truncate">{item.title}</span>
                <span className="ml-auto text-2xs text-muted-foreground">{projectState(layout, item.id).tabs.length}</span>
              </Button>
            ))}
          </div>
          {apps !== undefined && apps.length > 0 && (
            <div className="border-t border-border py-1">
              <div className="px-3 py-1 text-2xs uppercase tracking-wider text-muted-foreground">{t('sidebar.apps')}</div>
              {apps.map((app) => (
                <Button
                  key={app.key}
                  variant="ghost"
                  className="h-[26px] w-full justify-start rounded-none px-3 text-xs font-normal"
                  onClick={() => openPanel?.(app.key)}
                >
                  <span className="truncate">{app.label}</span>
                </Button>
              ))}
            </div>
          )}
          {activeProjectId !== null && (
            <div
              className="absolute -right-0.5 top-0 h-full w-1 cursor-col-resize hover:bg-primary/50"
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
    <div className="flex h-tab shrink-0 items-stretch overflow-x-auto border-b border-border bg-card" role="tablist">
      {state.tabs.map((tab, index) => {
        const Icon = KIND_ICON[tab.kind]
        const active = tab.id === state.activeTabId
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            draggable
            onDragStart={() => (dragIndex.current = index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              if (dragIndex.current !== null && activeProjectId !== null) {
                const from = dragIndex.current
                setLayout((prev) => moveTab(prev, activeProjectId, from, index))
              }
              dragIndex.current = null
            }}
            onClick={() => selectTab(tab.id)}
            onKeyDown={(event) => event.key === 'Enter' && selectTab(tab.id)}
            onAuxClick={(event) => {
              if (event.button === 1 && activeProjectId !== null) setLayout((prev) => closeTab(prev, activeProjectId, tab.id))
            }}
            className={cn(
              'group flex cursor-pointer items-center gap-1.5 whitespace-nowrap border-r border-t-2 border-border border-t-transparent px-2.5 text-xs text-muted-foreground',
              active && 'border-t-primary bg-background text-foreground',
            )}
          >
            <Icon className="h-3 w-3" aria-hidden />
            <span className="max-w-[160px] truncate">{tab.title}</span>
            <button
              type="button"
              aria-label="Close"
              className="grid h-3.5 w-3.5 place-items-center rounded opacity-0 hover:bg-accent group-hover:opacity-60"
              onClick={(event) => {
                event.stopPropagation()
                if (activeProjectId !== null) setLayout((prev) => closeTab(prev, activeProjectId, tab.id))
              }}
            >
              <X className="h-2.5 w-2.5" aria-hidden />
            </button>
          </div>
        )
      })}
      <div className="sticky right-0 ml-auto flex items-center gap-0.5 bg-card px-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" title={t('tabs.new')}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {newTabItems.map((item, index) => {
              const Icon = item.kind === 'openFile' ? FileText : KIND_ICON[item.kind]
              return (
                <React.Fragment key={item.kind}>
                  {index === 2 && <DropdownMenuSeparator />}
                  <DropdownMenuItem icon={<Icon className="h-3 w-3" />} onSelect={() => createTab(item.kind)}>
                    {item.label}
                  </DropdownMenuItem>
                </React.Fragment>
              )
            })}
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
              onSelect={() =>
                activeProjectId !== null &&
                activeTab !== undefined &&
                setLayout((prev) => {
                  let next = prev
                  for (const tab of projectState(prev, activeProjectId).tabs) {
                    if (tab.id !== activeTab.id) next = closeTab(next, activeProjectId, tab.id)
                  }
                  return next
                })
              }
            >
              {t('tabs.closeOthers')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                activeProjectId !== null &&
                setLayout((prev) => {
                  let next = prev
                  for (const tab of projectState(prev, activeProjectId).tabs) next = closeTab(next, activeProjectId, tab.id)
                  return next
                })
              }
            >
              {t('tabs.closeAll')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )

  const segments = activeTab?.kind === 'file' ? activeTab.contentId.split('/') : []
  const breadcrumb = (
    <div className="flex h-crumb shrink-0 items-center gap-1 overflow-hidden border-b border-border px-3 text-xs text-muted-foreground">
      {segments.length === 0 ? (
        <span>{activeTab === undefined ? t('panel.title') : activeTab.title}</span>
      ) : (
        <span className="truncate">{[project?.title ?? '', ...segments].join(' › ')}</span>
      )}
    </div>
  )

  let content: React.ReactNode
  if (activeTab === undefined) {
    content = (
      <div className="grid h-full place-content-center gap-2 px-6 text-center text-muted-foreground">
        <strong className="text-sm text-foreground">{t('empty.title')}</strong>
        <span className="text-xs">{t('empty.hint')}</span>
      </div>
    )
  } else if (remote === undefined) {
    content = <div className="p-3 text-xs text-muted-foreground">host bridge unavailable</div>
  } else if (activeTab.kind === 'file') {
    const line = typeof activeTab.params?.line === 'number' ? (activeTab.params.line as number) : undefined
    const markdown = /\.mdx?$/i.test(activeTab.contentId)
    content = markdown ? (
      <MarkdownView
        path={activeTab.contentId}
        sessionId={project?.sessionIds[0]}
        remote={remote}
        t={t}
        line={line}
      />
    ) : (
      <FileView
        path={activeTab.contentId}
        sessionId={project?.sessionIds[0]}
        remote={remote}
        t={t}
        line={line}
      />
    )
  } else if (activeTab.kind === 'explorer') {
    content = (
      <ExplorerView
        root={project?.path ?? ''}
        sessionId={project?.sessionIds[0]}
        remote={remote}
        onOpen={(path, name) => openFile(path, undefined, name)}
        t={t}
      />
    )
  } else if (activeTab.kind === 'browser') {
    content = (
      <BrowserView
        url={activeTab.contentId}
        t={t}
        onNavigate={(url) =>
          activeProjectId !== null &&
          setLayout((prev) => {
            const current = projectState(prev, activeProjectId)
            return {
              ...prev,
              projects: {
                ...prev.projects,
                [activeProjectId]: {
                  ...current,
                  tabs: current.tabs.map((tab) =>
                    tab.id === activeTab.id ? { ...tab, contentId: url, title: url.replace(/^https?:\/\//, '') } : tab,
                  ),
                },
              },
            }
          })
        }
      />
    )
  } else if (activeTab.kind === 'search') {
    content = (
      <SearchView
        root={project?.path ?? ''}
        autoFocus
        onOpen={(path, line) => openFile(path, line)}
        t={t}
      />
    )
  } else if (registry.get(activeTab.kind)?.render !== undefined) {
    content = registry.get(activeTab.kind)!.render!({ tab: activeTab })
  } else {
    content = (
      <div className="grid h-full place-content-center gap-2 text-center text-muted-foreground">
        <strong className="text-sm text-foreground">{activeTab.title}</strong>
        <span className="text-xs">{t('common.notYet')}</span>
      </div>
    )
  }

  return (
    <div className="workbench-root">
      {quickOpen && (
        <QuickOpen
          root={project?.path ?? ''}
          t={t}
          onOpen={(path) => openFile(path)}
          onClose={() => setQuickOpen(false)}
        />
      )}
      {sidebar}
      <div className="flex min-w-0 flex-1 flex-col">
        {tabStrip}
        {breadcrumb}
        <div className="wb-scroll relative min-h-0 flex-1 overflow-auto">{content}</div>
        <div className="flex h-status shrink-0 items-center gap-3 border-t border-border bg-card px-3 text-2xs text-muted-foreground">
          <span className="truncate">{project?.path ?? ''}</span>
          <span>{state.tabs.length} tabs</span>
          <span className="ml-auto flex gap-3">{activeTab?.kind === 'file' && <span>UTF-8</span>}</span>
        </div>
      </div>
    </div>
  )
}
