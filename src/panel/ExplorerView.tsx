import * as React from 'react'
import { ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronRight, FileCode2, Folder, X } from 'lucide-react'
import { call } from '../api'
import { Button } from '../ui/button'
import { cn } from '../ui/cn'
import { FileView } from './FileView'
import type { DirectoryEntry, Remote, Translate } from './types'

interface Props {
  root: string
  sessionId?: string
  remote: Remote
  /** Open a file in a top-level editor tab (the tree defaults to the inner pane). */
  onOpen: (path: string, name: string) => void
  t: Translate
}

type Branch = DirectoryEntry[] | 'loading' | 'error'
type Sort = 'name' | 'name-desc'

/** Hidden by default (R1.8); the real ignores are the host's, this is the floor. */
const HIDDEN = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.turbo', '.cache', 'coverage', '.DS_Store'])

/** Files get the colour of their language, so a tree stays scannable. */
function tintOf(name: string): string {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (['ts', 'tsx'].includes(extension)) return '#3B6FF5'
  if (['js', 'jsx', 'mjs', 'cjs'].includes(extension)) return '#9A6700'
  if (['json', 'jsonc'].includes(extension)) return '#9A6700'
  if (['md', 'mdx'].includes(extension)) return '#6E7781'
  if (['css', 'scss', 'less'].includes(extension)) return '#8250DF'
  if (['html', 'vue'].includes(extension)) return '#CF222E'
  if (['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'].includes(extension)) return '#1A7F37'
  return 'currentColor'
}

/** Directories first, then the chosen name order. */
function sorted(entries: DirectoryEntry[], sort: Sort): DirectoryEntry[] {
  const direction = sort === 'name' ? 1 : -1
  return entries.slice().sort((left, right) => {
    if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
    return direction * left.name.localeCompare(right.name, undefined, { numeric: true })
  })
}

/**
 * Explorer tab (v0.3): a split view — the tree on the left, files opening in
 * inner tabs on the right, so browsing does not spray top-level tabs. The
 * context menu still offers a real editor tab for people who want one.
 */
export function ExplorerView({ root, sessionId, remote, onOpen, t }: Props) {
  const [branches, setBranches] = React.useState<Record<string, Branch>>({})
  const [menu, setMenu] = React.useState<null | { x: number; y: number; path: string; isDir: boolean }>(null)
  const [sort, setSort] = React.useState<Sort>('name')
  const [panes, setPanes] = React.useState<{ path: string; name: string }[]>([])
  const [activePath, setActivePath] = React.useState<string | null>(null)
  const treeRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (menu === null) return
    const dismiss = () => setMenu(null)
    window.addEventListener('click', dismiss)
    window.addEventListener('blur', dismiss)
    return () => {
      window.removeEventListener('click', dismiss)
      window.removeEventListener('blur', dismiss)
    }
  }, [menu])

  const load = React.useCallback(
    (relative: string) => {
      if (sessionId === undefined) return
      setBranches((prev) => ({ ...prev, [relative]: 'loading' }))
      remote.workspaceFiles
        .list(sessionId, relative === '' ? '.' : relative)
        .then((result) =>
          setBranches((prev) => ({
            ...prev,
            [relative]: result.ok ? result.value.entries.filter((entry) => !HIDDEN.has(entry.name)) : 'error',
          })),
        )
        .catch(() => setBranches((prev) => ({ ...prev, [relative]: 'error' })))
    },
    [remote, sessionId],
  )

  React.useEffect(() => {
    load('')
  }, [load])

  const collapse = (path: string) =>
    setBranches((prev) => {
      const next = { ...prev }
      delete next[path]
      return next
    })

  /* Inner tabs: dedupe by path, and closing the active one picks a neighbour. */
  const openInPane = (path: string, name: string) => {
    setPanes((prev) => (prev.some((pane) => pane.path === path) ? prev : [...prev, { path, name }]))
    setActivePath(path)
  }

  const closePane = (path: string) => {
    setPanes((prev) => {
      const index = prev.findIndex((pane) => pane.path === path)
      const next = prev.filter((pane) => pane.path !== path)
      if (activePath === path) setActivePath(next[Math.min(index, next.length - 1)]?.path ?? null)
      return next
    })
  }

  const level = (relative: string, depth: number): React.ReactNode => {
    const branch = branches[relative]
    if (branch === undefined || branch === 'loading') {
      return <div className="px-3 py-1 text-2xs text-muted-foreground">{t('explorer.loading')}</div>
    }
    if (branch === 'error') return <div className="px-3 py-1 text-2xs text-muted-foreground">{t('explorer.failed')}</div>
    if (branch.length === 0) {
      return <div className="px-3 py-1 text-2xs text-muted-foreground">{t('explorer.empty')}</div>
    }
    return sorted(branch, sort).map((child) => {
      const childPath = relative === '' ? child.name : `${relative}/${child.name}`
      const isDir = child.type === 'directory'
      const open = branches[childPath] !== undefined
      const active = activePath === childPath
      return (
        <React.Fragment key={childPath}>
          <Button
            variant="ghost"
            className={cn('h-[22px] w-full justify-start gap-1 rounded-none px-1 text-xs font-normal', active && 'bg-accent text-accent-foreground')}
            style={{ paddingLeft: 4 + depth * 12 }}
            onClick={() => (isDir ? (open ? collapse(childPath) : load(childPath)) : openInPane(childPath, child.name))}
            onContextMenu={(event) => {
              event.preventDefault()
              setMenu({ x: event.clientX, y: event.clientY, path: childPath, isDir })
            }}
          >
            <span className="grid h-3 w-3 place-items-center text-muted-foreground">
              {isDir ? (
                open ? (
                  <ChevronDown className="h-3 w-3" aria-hidden />
                ) : (
                  <ChevronRight className="h-3 w-3" aria-hidden />
                )
              ) : null}
            </span>
            {isDir ? (
              <Folder className="h-3 w-3 text-muted-foreground" aria-hidden />
            ) : (
              <FileCode2 className="h-3 w-3" style={{ color: tintOf(child.name) }} aria-hidden />
            )}
            <span className="truncate">{child.name}</span>
          </Button>
          {isDir && open ? level(childPath, depth + 1) : null}
        </React.Fragment>
      )
    })
  }

  const active = panes.find((pane) => pane.path === activePath)

  return (
    <div className="flex h-full min-h-0 text-xs">
      <div className="relative flex w-[280px] shrink-0 flex-col border-r border-border">
        <div className="flex h-crumb shrink-0 items-center gap-1 border-b border-border px-2">
          <button
            type="button"
            className="truncate text-2xs text-muted-foreground hover:text-foreground"
            title={root}
            onClick={() => {
              load('')
              treeRef.current?.scrollTo({ top: 0 })
            }}
          >
            {root}
          </button>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-2xs"
            title={t('explorer.sort')}
            onClick={() => setSort((value) => (value === 'name' ? 'name-desc' : 'name'))}
          >
            {sort === 'name' ? t('explorer.sort.asc') : t('explorer.sort.desc')}
          </Button>
        </div>
        <div ref={treeRef} className="wb-scroll relative min-h-0 flex-1 overflow-auto py-1">
          {level('', 0)}
        </div>
        {/* Reachable without a mouse wheel: the tree can be hundreds of rows deep. */}
        <div className="absolute bottom-2 right-2 flex flex-col gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-6 w-6 opacity-80"
            title={t('explorer.scrollTop')}
            onClick={() => treeRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <ArrowUpToLine className="h-3 w-3" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-6 w-6 opacity-80"
            title={t('explorer.scrollBottom')}
            onClick={() => treeRef.current?.scrollTo({ top: treeRef.current.scrollHeight, behavior: 'smooth' })}
          >
            <ArrowDownToLine className="h-3 w-3" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {panes.length === 0 ? (
          <div className="grid flex-1 place-content-center gap-1 px-6 text-center text-muted-foreground">
            <strong className="text-sm text-foreground">{t('explorer.paneEmpty')}</strong>
            <span className="text-2xs">{t('explorer.paneEmptyHint')}</span>
          </div>
        ) : (
          <>
            <div className="flex h-crumb shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border bg-[var(--tabstrip-bg)] px-1">
              {panes.map((pane) => (
                <div
                  key={pane.path}
                  className={cn(
                    'group flex items-center gap-1 rounded-sm px-2 text-xs',
                    pane.path === activePath ? 'bg-[var(--background)] text-foreground' : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  <button type="button" className="max-w-[160px] truncate py-1" onClick={() => setActivePath(pane.path)} title={pane.path}>
                    {pane.name}
                  </button>
                  <button
                    type="button"
                    className="grid h-4 w-4 place-items-center rounded opacity-0 group-hover:opacity-100 hover:bg-accent"
                    title={t('tabs.close')}
                    onClick={() => closePane(pane.path)}
                  >
                    <X className="h-2.5 w-2.5" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              {active !== undefined && sessionId !== undefined ? (
                <FileView key={active.path} path={active.path} sessionId={sessionId} remote={remote} t={t} />
              ) : (
                <div className="grid h-full place-content-center text-2xs text-muted-foreground">{t('panel.noBridge')}</div>
              )}
            </div>
          </>
        )}
      </div>

      {menu !== null && (
        <div className="workbench-portal fixed z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 text-xs shadow-lg" style={{ left: menu.x, top: menu.y }}>
          <Button
            variant="ghost"
            className="h-[24px] w-full justify-start px-2 text-xs font-normal"
            onClick={() => {
              if (menu.isDir) load(menu.path)
              else openInPane(menu.path, menu.path.split('/').pop() ?? menu.path)
              setMenu(null)
            }}
          >
            {t('explorer.open')}
          </Button>
          {!menu.isDir && (
            <Button
              variant="ghost"
              className="h-[24px] w-full justify-start px-2 text-xs font-normal"
              onClick={() => {
                onOpen(menu.path, menu.path.split('/').pop() ?? menu.path)
                setMenu(null)
              }}
            >
              {t('explorer.openInTab')}
            </Button>
          )}
          <Button
            variant="ghost"
            className="h-[24px] w-full justify-start px-2 text-xs font-normal"
            onClick={() => {
              void navigator.clipboard?.writeText(`${root}/${menu.path}`)
              setMenu(null)
            }}
          >
            {t('explorer.copyPath')}
          </Button>
          <Button
            variant="ghost"
            className="h-[24px] w-full justify-start px-2 text-xs font-normal"
            onClick={() => {
              void call('path.reveal', { path: `${root}/${menu.path}` }).catch(() => undefined)
              setMenu(null)
            }}
          >
            {t('explorer.reveal')}
          </Button>
        </div>
      )}
    </div>
  )
}
