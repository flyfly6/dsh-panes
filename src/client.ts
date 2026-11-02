/**
 * dsh-workbench — browser half.
 *
 * Registers the Workbench `main` panel plus its sidebar launcher, and renders the
 * project sidebar + tab workspace shell (T1 §1–§3). Tab rules live in ./tabs.ts;
 * this file is layout, keys, and the file/explorer tab bodies.
 */
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
} from './tabs'

const PLUGIN_ID = 'dsh-workbench'
const API = '/dsh-workbench/api'
const NS = 'workbench'
const PANEL_KEY = 'workbench'
const STORE_KEY = 'dsh-workbench:layout'
const FILE_PAGE = 800

type Dict = Record<string, string>

const zh: Dict = {
  'panel.title': '工作台',
  'panel.back': '返回会话',
  'sidebar.projects': '项目',
  'sidebar.collapse': '折叠侧栏',
  'sidebar.expand': '展开侧栏',
  'sidebar.filter': '过滤项目',
  'sidebar.apps': '应用',
  'tabs.new': '新建 tab',
  'tabs.more': '更多操作',
  'tabs.closeOthers': '关闭其他',
  'tabs.closeAll': '全部关闭',
  'tabs.reopen': '重开已关闭',
  'tab.session': '会话',
  'tab.file': '文件',
  'tab.explorer': '资源管理器',
  'tab.search': '搜索',
  'tab.terminal': '终端',
  'tab.browser': '浏览器',
  'tab.git': '源代码管理',
  'tab.note': '笔记',
  'menu.openFile': '打开文件…',
  'empty.title': '还没有打开的 tab',
  'empty.hint': '用 + 打开会话、文件、终端或搜索。',
  'file.loading': '读取中…',
  'file.changed': '文件已变化，点击重载',
  'file.failed': '无法读取文件',
  'file.binary': '该文件不是 UTF-8 文本',
  'explorer.loading': '加载中…',
  'explorer.empty': '空目录',
  'explorer.failed': '无法列目录',
  'common.notYet': '该 tab 类型将在后续阶段接入。',
}

const en: Dict = {
  'panel.title': 'Workbench',
  'panel.back': 'Back to conversation',
  'sidebar.projects': 'PROJECTS',
  'sidebar.collapse': 'Collapse sidebar',
  'sidebar.expand': 'Expand sidebar',
  'sidebar.filter': 'Filter projects',
  'sidebar.apps': 'Apps',
  'tabs.new': 'New tab',
  'tabs.more': 'More actions',
  'tabs.closeOthers': 'Close others',
  'tabs.closeAll': 'Close all',
  'tabs.reopen': 'Undo close',
  'tab.session': 'Session',
  'tab.file': 'File',
  'tab.explorer': 'Explorer',
  'tab.search': 'Search',
  'tab.terminal': 'Terminal',
  'tab.browser': 'Browser',
  'tab.git': 'Source control',
  'tab.note': 'Note',
  'menu.openFile': 'Open file…',
  'empty.title': 'No tab open yet',
  'empty.hint': 'Use + to open a session, file, terminal or search.',
  'file.loading': 'Reading…',
  'file.changed': 'File changed on disk, click to reload',
  'file.failed': 'Could not read the file',
  'file.binary': 'Not a UTF-8 text file',
  'explorer.loading': 'Loading…',
  'explorer.empty': 'Empty directory',
  'explorer.failed': 'Could not list the directory',
  'common.notYet': 'This tab type arrives in a later phase.',
}

/** Design tokens: shadcn-style aliases mapped onto host theme variables. */
const STYLE = `
.workbench-root {
  --background: var(--dsw-alias-bg-base);
  --sidebar-bg: var(--dsw-alias-bg-layer-2);
  --foreground: var(--dsw-alias-text-primary);
  --muted-foreground: var(--dsw-alias-text-secondary);
  --faint-foreground: var(--dsw-alias-text-tertiary, var(--dsw-alias-text-secondary));
  --border: var(--dsw-alias-border-l2);
  --accent: var(--dsw-alias-brand-primary);
  --hover: var(--dsw-alias-bg-layer-3);
  --radius: 6px;
  display: flex; height: 100%; width: 100%; overflow: hidden;
  background: var(--background); color: var(--foreground);
  font-size: 13px; line-height: 1.5;
  padding-top: var(--dsh-frame-top-clearance, 0px);
  box-sizing: border-box;
}
.workbench-root * { box-sizing: border-box; }
.wb-sidebar { display: flex; flex-direction: column; background: var(--sidebar-bg); border-right: 1px solid var(--border); position: relative; flex: none; }
.wb-sidebar-resizer { position: absolute; top: 0; right: -2px; width: 4px; height: 100%; cursor: col-resize; z-index: 2; }
.wb-sidebar-resizer:hover { background: var(--accent); opacity: .5; }
.wb-main { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.wb-tabstrip { display: flex; align-items: stretch; height: 42px; border-bottom: 1px solid var(--border); background: var(--sidebar-bg); overflow-x: auto; scrollbar-width: thin; }
.wb-tab { display: flex; align-items: center; gap: 6px; padding: 0 10px; border: 0; border-right: 1px solid var(--border); border-top: 2px solid transparent; cursor: pointer; white-space: nowrap; color: var(--muted-foreground); background: transparent; font: inherit; }
.wb-tab[data-active="true"] { background: var(--background); color: var(--foreground); border-top-color: var(--accent); }
.wb-tab:hover { background: var(--hover); }
.wb-tab-close { color: inherit; cursor: pointer; opacity: .55; padding: 0 2px; font-size: 13px; line-height: 1; }
.wb-tab-close:hover { opacity: 1; }
.wb-strip-actions { display: flex; align-items: center; gap: 2px; margin-left: auto; padding: 0 6px; position: sticky; right: 0; background: var(--sidebar-bg); }
.wb-icon-button { all: unset; cursor: pointer; display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--radius); color: var(--muted-foreground); font-size: 15px; }
.wb-icon-button:hover { background: var(--hover); color: var(--foreground); }
.wb-breadcrumb { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-bottom: 1px solid var(--border); color: var(--muted-foreground); font-size: 11.5px; overflow: hidden; white-space: nowrap; }
.wb-content { flex: 1; min-height: 0; overflow: auto; position: relative; }
.wb-status { display: flex; align-items: center; gap: 12px; height: 26px; padding: 0 12px; border-top: 1px solid var(--border); background: var(--sidebar-bg); color: var(--muted-foreground); font-size: 11px; }
.wb-status-right { margin-left: auto; display: flex; gap: 12px; }
.wb-row { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 6px 10px; border: 0; border-left: 2px solid transparent; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.wb-row:hover { background: var(--hover); }
.wb-row[data-active="true"] { background: var(--hover); border-left-color: var(--accent); }
.wb-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wb-row-meta { margin-left: auto; color: var(--faint-foreground); font-size: 10.5px; }
.wb-sidebar-head { display: flex; align-items: center; gap: 4px; height: 42px; padding: 0 8px; border-bottom: 1px solid var(--border); }
.wb-sidebar-head-label { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint-foreground); margin-left: 4px; }
.wb-filter { margin: 8px; padding: 4px 8px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--background); color: var(--foreground); font: inherit; font-size: 11.5px; }
.wb-sidebar-foot { margin-top: auto; border-top: 1px solid var(--border); padding: 4px 0; }
.wb-rail { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 0; }
.wb-rail-project { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; border: 1px solid var(--border); background: var(--background); color: var(--muted-foreground); cursor: pointer; font-size: 12px; }
.wb-rail-project[data-active="true"] { border-color: var(--accent); color: var(--foreground); }
.wb-menu { position: fixed; z-index: 10; min-width: 190px; background: var(--background); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.18); padding: 4px; }
.wb-menu-item { display: flex; width: 100%; gap: 8px; align-items: center; padding: 6px 8px; border: 0; background: transparent; color: inherit; font: inherit; border-radius: 4px; cursor: pointer; text-align: left; }
.wb-menu-item:hover { background: var(--hover); }
.wb-empty { height: 100%; display: grid; place-content: center; gap: 8px; text-align: center; color: var(--muted-foreground); padding: 24px; }
.wb-empty strong { color: var(--foreground); font-size: 14px; }
.wb-code { display: flex; font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 22px; padding: 8px 0; }
.wb-code-gutter { text-align: right; color: var(--faint-foreground); user-select: none; padding: 0 8px 0 12px; border-right: 1px solid var(--border); }
.wb-code-body { padding: 0 12px; white-space: pre; overflow-x: auto; flex: 1; }
.wb-code-body[data-wrap="true"] { white-space: pre-wrap; word-break: break-word; }
.wb-tree { padding: 4px 0; font-size: 12.5px; }
.wb-tree-row { display: flex; align-items: center; gap: 6px; width: 100%; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 3px 8px; text-align: left; }
.wb-tree-row:hover { background: var(--hover); }
.wb-error { padding: 12px; color: #cf222e; font-size: 12px; }
`

let disposed = false

function installStyle(): () => void {
  const style = document.createElement('style')
  style.dataset.pluginCss = PLUGIN_ID
  style.textContent = STYLE
  document.head.append(style)
  return () => style.remove()
}

async function call(op: string, args: Record<string, unknown> = {}): Promise<any> {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dsh-plugin': PLUGIN_ID },
    body: JSON.stringify({ op, args }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ok !== true) throw new Error(body?.message ?? `HTTP ${response.status}`)
  return body.data
}

/** Tab types other bundles add (T2 git, T3 notes) through `ctx.workbenchTabs`. */
interface TabTypeSpec {
  kind: TabKind
  order?: number
  render?: (props: { tab: TabModel }) => any
}

function createRegistry() {
  const types = new Map<string, TabTypeSpec>()
  return {
    register(spec: TabTypeSpec): () => void {
      types.set(spec.kind, spec)
      return () => void types.delete(spec.kind)
    },
    get(kind: string): TabTypeSpec | undefined {
      return types.get(kind)
    },
    kinds(): TabTypeSpec[] {
      return [...types.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
    },
  }
}

function factory(require: (id: string) => any) {
  const React = require('react') as typeof import('react')
  const h = React.createElement
  const { useCallback, useEffect, useMemo, useRef, useState } = React

  type Remote = { workspaceFiles: { list: any; read: any } }
  type Project = { id: string; title: string; path: string; sessionIds: string[] }
  type Props = {
    t: (key: string) => string
    close: () => void
    useWorkspaces: (selector: (snapshot: any) => unknown) => any
    remote?: Remote
    apps?: { key: string; label: string }[]
    openPanel?: (key: string) => void
  }

  const registry = createRegistry()

  function readStored(): Layout {
    try {
      return parseLayout(window.localStorage.getItem(STORE_KEY))
    } catch {
      return parseLayout(null)
    }
  }

  function storeLayout(layout: Layout): void {
    try {
      window.localStorage.setItem(STORE_KEY, serializeLayout(layout))
    } catch {
      /* private mode / quota: keep the in-memory layout */
    }
  }

  function projectsOf(items: any[]): Project[] {
    return (Array.isArray(items) ? items : []).map((item: any) => ({
      id: String(item.workspaceId),
      title: String(item.title ?? item.path ?? ''),
      path: String(item.path ?? ''),
      sessionIds: Array.isArray(item.sessionIds) ? item.sessionIds.map(String) : [],
    }))
  }

  // ---------------------------------------------------------------- file view

  function FileView({ path, sessionId, remote, t }: { path: string; sessionId?: string; remote: Remote; t: (k: string) => string }) {
    const [state, setState] = useState<any>({ status: 'loading', text: '', error: '' })
    const [wrap, setWrap] = useState(false)
    const [token, setToken] = useState(0)

    useEffect(() => {
      if (sessionId === undefined) {
        setState({ status: 'error', text: '', error: t('file.failed') })
        return
      }
      let live = true
      setState((prev: any) => ({ ...prev, status: 'loading' }))
      remote.workspaceFiles
        .read(sessionId, path, { offset: 1, limit: FILE_PAGE })
        .then((result: any) => {
          if (!live) return
          if (result?.ok === true) setState({ status: 'ready', text: String(result.value.text), error: '' })
          else {
            const code = String(result?.error?.code ?? '')
            setState({ status: 'error', text: '', error: code.includes('not-text') ? t('file.binary') : t('file.failed') })
          }
        })
        .catch((error: Error) => live && setState({ status: 'error', text: '', error: error.message }))
      return () => {
        live = false
      }
    }, [path, sessionId, token, t])

    if (state.status === 'loading') return h('div', { className: 'wb-empty' }, t('file.loading'))
    if (state.status === 'error') return h('div', { className: 'wb-error' }, state.error)
    const rows = String(state.text).split('\n')
    return h(
      'div',
      { style: { height: '100%', overflow: 'auto' }, onDoubleClick: () => setWrap((value: boolean) => !value) },
      h(
        'div',
        { className: 'wb-code' },
        h('div', { className: 'wb-code-gutter', 'aria-hidden': true }, rows.map((_: string, index: number) => h('div', { key: index }, index + 1))),
        h('div', { className: 'wb-code-body', 'data-wrap': wrap ? 'true' : 'false' }, state.text),
      ),
      h('button', { type: 'button', className: 'wb-menu-item', onClick: () => setToken((value: number) => value + 1) }, t('file.changed')),
    )
  }

  // ------------------------------------------------------------- explorer view

  function ExplorerView({ root, sessionId, remote, onOpen, t }: { root: string; sessionId?: string; remote: Remote; onOpen: (path: string, name: string) => void; t: (k: string) => string }) {
    const [nodes, setNodes] = useState<Record<string, any>>({})

    const load = useCallback(
      (relative: string) => {
        if (sessionId === undefined) return
        setNodes((prev) => ({ ...prev, [relative]: 'loading' }))
        remote.workspaceFiles
          .list(sessionId, relative === '' ? '.' : relative)
          .then((result: any) =>
            setNodes((prev) => ({ ...prev, [relative]: result?.ok === true ? result.value.entries : 'error' })),
          )
          .catch(() => setNodes((prev) => ({ ...prev, [relative]: 'error' })))
      },
      [remote, sessionId],
    )

    useEffect(() => {
      load('')
    }, [load])

    const level = (relative: string, depth: number): any[] => {
      const node = nodes[relative]
      if (node === undefined || node === 'loading') {
        return [h('div', { key: `${relative}:loading`, className: 'wb-tree-row', style: { color: 'var(--faint-foreground)' } }, t('explorer.loading'))]
      }
      if (node === 'error') return [h('div', { key: `${relative}:error`, className: 'wb-error' }, t('explorer.failed'))]
      if (node.length === 0) {
        return [h('div', { key: `${relative}:empty`, className: 'wb-tree-row', style: { color: 'var(--faint-foreground)' } }, t('explorer.empty'))]
      }
      return node.map((child: any) => {
        const childPath = relative === '' ? child.name : `${relative}/${child.name}`
        const isDir = child.type === 'directory'
        const isOpen = nodes[childPath] !== undefined
        return h(
          'div',
          { key: childPath },
          h(
            'button',
            {
              type: 'button',
              className: 'wb-tree-row',
              style: { paddingLeft: 8 + depth * 12 },
              onClick: () => {
                if (!isDir) {
                  onOpen(childPath, String(child.name))
                  return
                }
                if (isOpen) {
                  setNodes((prev) => {
                    const next = { ...prev }
                    delete next[childPath]
                    return next
                  })
                } else load(childPath)
              },
            },
            h('span', { style: { width: 10, color: 'var(--faint-foreground)' } }, isDir ? (isOpen ? '▾' : '▸') : ''),
            h('span', { className: 'wb-row-title' }, String(child.name)),
          ),
          isDir && isOpen ? level(childPath, depth + 1) : null,
        )
      })
    }

    return h('div', { className: 'wb-tree' }, h('div', { className: 'wb-tree-row', style: { color: 'var(--faint-foreground)' } }, root), level('', 0))
  }

  // ------------------------------------------------------------------- panel

  function WorkbenchPanel(props: Props) {
    const { t, close, useWorkspaces, remote, apps, openPanel } = props
    const items = useWorkspaces((snapshot: any) => snapshot.items)
    const projects = useMemo(() => projectsOf(items), [items])
    const [layout, setLayout] = useState<Layout>(readStored)
    const [filter, setFilter] = useState('')
    const [menu, setMenu] = useState<null | { kind: 'new' | 'more'; x: number; y: number }>(null)
    const dragIndex = useRef<number | null>(null)

    useEffect(() => {
      setLayout((prev: Layout) => {
        let next = prev
        for (const project of projects) next = ensureProject(next, project.id)
        if (next.activeProjectId === null && projects[0] !== undefined) next = setActiveProject(next, projects[0].id)
        return next === prev ? prev : next
      })
    }, [projects])

    useEffect(() => {
      storeLayout(layout)
    }, [layout])

    const activeProjectId = layout.activeProjectId ?? projects[0]?.id ?? null
    const project = projects.find((item) => item.id === activeProjectId)
    const state: ProjectTabs =
      activeProjectId === null
        ? { tabs: [], activeTabId: null, closed: [], sidebar: { width: SIDEBAR_WIDTH.default, collapsed: false } }
        : projectState(layout, activeProjectId)
    const activeTab = state.tabs.find((tab: TabModel) => tab.id === state.activeTabId)

    const open = useCallback(
      (input: { kind: TabKind; contentId: string; title: string }) => {
        if (activeProjectId !== null) setLayout((prev: Layout) => openTab(prev, activeProjectId, input))
      },
      [activeProjectId],
    )
    const openFile = useCallback(
      (path: string, name?: string) => open({ kind: 'file', contentId: path, title: name ?? path.split('/').pop() ?? path }),
      [open],
    )

    useEffect(() => {
      const onKey = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null
        const typing = target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        if (event.key === 'Escape' && menu === null && !typing) {
          event.preventDefault()
          close()
          return
        }
        if (!(event.ctrlKey || event.metaKey)) return
        const key = event.key.toLowerCase()
        if (key === 'w' && activeTab !== undefined && activeProjectId !== null) {
          event.preventDefault()
          setLayout((prev: Layout) => closeTab(prev, activeProjectId, activeTab.id))
        } else if (key === 'b' && activeProjectId !== null) {
          event.preventDefault()
          setLayout((prev: Layout) => setSidebar(prev, activeProjectId, { collapsed: !projectState(prev, activeProjectId).sidebar.collapsed }))
        } else if (key === 't' && event.shiftKey && activeProjectId !== null) {
          event.preventDefault()
          setLayout((prev: Layout) => reopenLast(prev, activeProjectId))
        } else if (event.key === 'Tab' && activeProjectId !== null && state.tabs.length > 1) {
          event.preventDefault()
          const index = state.tabs.findIndex((tab: TabModel) => tab.id === state.activeTabId)
          const next = state.tabs[(index + (event.shiftKey ? -1 : 1) + state.tabs.length) % state.tabs.length]!
          setLayout((prev: Layout) => ({ ...prev, projects: { ...prev.projects, [activeProjectId]: { ...projectState(prev, activeProjectId), activeTabId: next.id } } }))
        }
      }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }, [activeProjectId, activeTab, close, menu, state.tabs, state.activeTabId])

    useEffect(() => {
      if (menu === null) return
      const dismiss = () => setMenu(null)
      window.addEventListener('click', dismiss)
      return () => window.removeEventListener('click', dismiss)
    }, [menu])

    const createTab = (kind: TabKind | 'openFile') => {
      setMenu(null)
      if (kind === 'openFile') {
        const path = window.prompt(t('menu.openFile'))
        if (path !== null && path.trim() !== '') openFile(path.trim())
        return
      }
      if (kind === 'browser') {
        const url = window.prompt('URL', 'https://')
        if (url !== null && url.trim() !== '') open({ kind: 'browser', contentId: url.trim(), title: url.trim() })
        return
      }
      open({ kind, contentId: kind, title: t(`tab.${kind}`) })
    }

    const visibleProjects = projects.filter((item) => filter === '' || item.title.toLowerCase().includes(filter.toLowerCase()))
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

    const sidebar = state.sidebar.collapsed
      ? h(
          'div',
          { className: 'wb-sidebar', style: { width: SIDEBAR_WIDTH.collapsed } },
          h(
            'div',
            { className: 'wb-rail' },
            h('button', { type: 'button', className: 'wb-icon-button', title: t('panel.back'), onClick: close }, '←'),
            activeProjectId !== null &&
              h('button', { type: 'button', className: 'wb-icon-button', title: t('sidebar.expand'), onClick: () => setLayout((prev: Layout) => setSidebar(prev, activeProjectId, { collapsed: false })) }, '»'),
            visibleProjects.map((item) =>
              h(
                'button',
                {
                  key: item.id,
                  type: 'button',
                  className: 'wb-rail-project',
                  'data-active': item.id === activeProjectId ? 'true' : 'false',
                  title: item.title,
                  onClick: () => setLayout((prev: Layout) => setActiveProject(prev, item.id)),
                },
                (item.title[0] ?? '?').toUpperCase(),
              ),
            ),
          ),
        )
      : h(
          'div',
          { className: 'wb-sidebar', style: { width: state.sidebar.width } },
          h(
            'div',
            { className: 'wb-sidebar-head' },
            h('button', { type: 'button', className: 'wb-icon-button', title: t('panel.back'), onClick: close }, '←'),
            h('span', { className: 'wb-sidebar-head-label' }, t('sidebar.projects')),
            h('span', { style: { flex: 1 } }),
            activeProjectId !== null &&
              h('button', { type: 'button', className: 'wb-icon-button', title: t('sidebar.collapse'), onClick: () => setLayout((prev: Layout) => setSidebar(prev, activeProjectId, { collapsed: true })) }, '«'),
          ),
          h('input', { className: 'wb-filter', placeholder: t('sidebar.filter'), value: filter, onChange: (event: any) => setFilter(String(event.target.value)) }),
          h(
            'div',
            { style: { overflow: 'auto', flex: 1 } },
            visibleProjects.map((item) =>
              h(
                'button',
                {
                  key: item.id,
                  type: 'button',
                  className: 'wb-row',
                  'data-active': item.id === activeProjectId ? 'true' : 'false',
                  onClick: () => setLayout((prev: Layout) => setActiveProject(prev, item.id)),
                },
                h('span', { className: 'wb-row-title' }, item.title),
                h('span', { className: 'wb-row-meta' }, String(projectState(layout, item.id).tabs.length)),
              ),
            ),
          ),
          apps !== undefined && apps.length > 0
            ? h(
                'div',
                { className: 'wb-sidebar-foot' },
                h('div', { className: 'wb-sidebar-head-label', style: { padding: '4px 12px' } }, t('sidebar.apps')),
                apps.map((app) => h('button', { key: app.key, type: 'button', className: 'wb-row', onClick: () => openPanel?.(app.key) }, h('span', { className: 'wb-row-title' }, app.label))),
              )
            : null,
          activeProjectId !== null &&
            h('div', {
              className: 'wb-sidebar-resizer',
              onDoubleClick: () => setLayout((prev: Layout) => setSidebar(prev, activeProjectId, { width: SIDEBAR_WIDTH.default })),
              onMouseDown: (down: any) => {
                const startX = down.clientX
                const startWidth = state.sidebar.width
                const move = (event: MouseEvent) => setLayout((prev: Layout) => setSidebar(prev, activeProjectId, { width: startWidth + event.clientX - startX }))
                const up = () => {
                  window.removeEventListener('mousemove', move)
                  window.removeEventListener('mouseup', up)
                }
                window.addEventListener('mousemove', move)
                window.addEventListener('mouseup', up)
              },
            }),
        )

    const selectTab = (id: string) => {
      if (activeProjectId === null) return
      setLayout((prev: Layout) => {
        const current = projectState(prev, activeProjectId)
        return { ...prev, projects: { ...prev.projects, [activeProjectId]: { ...current, activeTabId: id } } }
      })
    }

    const tabStrip = h(
      'div',
      { className: 'wb-tabstrip', role: 'tablist' },
      state.tabs.map((tab: TabModel, index: number) =>
        h(
          'button',
          {
            key: tab.id,
            type: 'button',
            role: 'tab',
            className: 'wb-tab',
            'data-active': tab.id === state.activeTabId ? 'true' : 'false',
            'aria-selected': tab.id === state.activeTabId,
            draggable: true,
            onDragStart: () => (dragIndex.current = index),
            onDragOver: (event: any) => event.preventDefault(),
            onDrop: (event: any) => {
              event.preventDefault()
              if (dragIndex.current !== null && activeProjectId !== null) {
                setLayout((prev: Layout) => moveTab(prev, activeProjectId, dragIndex.current!, index))
              }
              dragIndex.current = null
            },
            onClick: () => selectTab(tab.id),
            onAuxClick: (event: any) => {
              if (event.button === 1 && activeProjectId !== null) setLayout((prev: Layout) => closeTab(prev, activeProjectId, tab.id))
            },
          },
          h('span', { className: 'wb-row-title' }, tab.title),
          h(
            'span',
            {
              className: 'wb-tab-close',
              onClick: (event: any) => {
                event.stopPropagation()
                if (activeProjectId !== null) setLayout((prev: Layout) => closeTab(prev, activeProjectId, tab.id))
              },
            },
            '×',
          ),
        ),
      ),
      h(
        'div',
        { className: 'wb-strip-actions' },
        h(
          'button',
          {
            type: 'button',
            className: 'wb-icon-button',
            title: t('tabs.new'),
            onClick: (event: any) => {
              event.stopPropagation()
              const rect = event.currentTarget.getBoundingClientRect()
              setMenu({ kind: 'new', x: Math.max(8, rect.left - 160), y: rect.bottom + 4 })
            },
          },
          '+',
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'wb-icon-button',
            title: t('tabs.more'),
            onClick: (event: any) => {
              event.stopPropagation()
              const rect = event.currentTarget.getBoundingClientRect()
              setMenu({ kind: 'more', x: Math.max(8, rect.left - 160), y: rect.bottom + 4 })
            },
          },
          '⋯',
        ),
      ),
    )

    const segments = activeTab?.kind === 'file' ? activeTab.contentId.split('/') : []
    const breadcrumb = h(
      'div',
      { className: 'wb-breadcrumb' },
      segments.length === 0
        ? h('span', null, activeTab === undefined ? t('panel.title') : activeTab.title)
        : h('span', null, [project?.title ?? '', ...segments].join(' › ')),
    )

    let content: any
    if (activeTab === undefined) {
      content = h('div', { className: 'wb-empty' }, h('strong', null, t('empty.title')), h('span', null, t('empty.hint')))
    } else if (remote === undefined) {
      content = h('div', { className: 'wb-error' }, 'host bridge unavailable')
    } else {
      const sessionId = project?.sessionIds[0]
      if (activeTab.kind === 'file') content = h(FileView, { path: activeTab.contentId, sessionId, remote, t })
      else if (activeTab.kind === 'explorer') content = h(ExplorerView, { root: project?.path ?? '', sessionId, remote, onOpen: openFile, t })
      else if (registry.get(activeTab.kind)?.render !== undefined) content = registry.get(activeTab.kind)!.render!({ tab: activeTab })
      else content = h('div', { className: 'wb-empty' }, h('strong', null, activeTab.title), h('span', null, t('common.notYet')))
    }

    const status = h(
      'div',
      { className: 'wb-status' },
      h('span', null, project?.path ?? ''),
      h('span', null, `${state.tabs.length} tabs`),
      h('span', { className: 'wb-status-right' }, h('span', null, activeTab?.kind === 'file' ? 'UTF-8' : '')),
    )

    return h(
      'div',
      { className: 'workbench-root' },
      sidebar,
      h('div', { className: 'wb-main' }, tabStrip, breadcrumb, h('div', { className: 'wb-content' }, content), status),
      menu !== null &&
        h(
          'div',
          { className: 'wb-menu', style: { left: menu.x, top: menu.y } },
          menu.kind === 'new'
            ? newTabItems.map((item) => h('button', { key: item.kind, type: 'button', className: 'wb-menu-item', onClick: () => createTab(item.kind) }, item.label))
            : [
                h('button', { key: 'reopen', type: 'button', className: 'wb-menu-item', onClick: () => { setMenu(null); if (activeProjectId !== null) setLayout((prev: Layout) => reopenLast(prev, activeProjectId)) } }, t('tabs.reopen')),
                h('button', {
                  key: 'others',
                  type: 'button',
                  className: 'wb-menu-item',
                  onClick: () => {
                    setMenu(null)
                    if (activeProjectId === null || activeTab === undefined) return
                    setLayout((prev: Layout) => {
                      let next = prev
                      for (const tab of projectState(prev, activeProjectId).tabs) if (tab.id !== activeTab.id) next = closeTab(next, activeProjectId, tab.id)
                      return next
                    })
                  },
                }, t('tabs.closeOthers')),
                h('button', {
                  key: 'all',
                  type: 'button',
                  className: 'wb-menu-item',
                  onClick: () => {
                    setMenu(null)
                    if (activeProjectId === null) return
                    setLayout((prev: Layout) => {
                      let next = prev
                      for (const tab of projectState(prev, activeProjectId).tabs) next = closeTab(next, activeProjectId, tab.id)
                      return next
                    })
                  },
                }, t('tabs.closeAll')),
              ],
        ),
    )
  }

  /** Sidebar glyph for the launcher row. */
  function PanelIcon({ size }: { size: number }) {
    return h(
      'svg',
      { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, 'aria-hidden': true },
      h('rect', { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2 }),
      h('line', { x1: 6, y1: 2.5, x2: 6, y2: 13.5 }),
      h('line', { x1: 6, y1: 7, x2: 14.5, y2: 7 }),
    )
  }

  const inject = ['slots', 'layout', 'locale', 'workspaces', 'remote', 'remote.workspaceFiles'] as const

  function apply(ctx: any) {
    if (disposed) return
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-workbench: locale')
    const t = ctx.locale.bind(NS)
    const close = () => ctx.layout.selectPanel(null)
    ctx.effect(() => installStyle(), 'dsh-workbench: styles')

    // T2/T3 add their tab types through this service.
    try {
      ctx.provide('workbenchTabs', registry)
    } catch {
      /* host without provide(): built-in kinds still work */
    }

    const apps = () => {
      try {
        return (ctx.slots.entries('main') ?? [])
          .filter((entry: any) => typeof entry?.options?.key === 'string' && entry.options.key !== PANEL_KEY)
          .map((entry: any) => ({ key: String(entry.options.key), label: String(entry.options.label ?? entry.options.key) }))
      } catch {
        return []
      }
    }

    ctx.effect(
      () =>
        ctx.slots.inject('main', () =>
          ctx.slots.register(
            { name: 'main', key: PANEL_KEY, locale: NS, inject: () => ({ t, close, remote: ctx.remote, apps: apps(), openPanel: (key: string) => ctx.layout.selectPanel(key) }) },
            WorkbenchPanel,
          ),
        ),
      'dsh-workbench: workbench panel',
    )
    ctx.effect(
      () => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_KEY, order: 40, label: () => t('panel.title') }, PanelIcon)),
      'dsh-workbench: sidebar launcher',
    )
  }

  return { name: PLUGIN_ID, inject, apply, call, registry }
}

const loader = (window as any).__ModuleLoader__ as
  | { load(entry: { id: string; factory: (require: (id: string) => any) => any }): void }
  | undefined
loader?.load({ id: PLUGIN_ID, factory })
