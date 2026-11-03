import * as React from 'react'
import { ChevronDown, ChevronRight, FileCode2, Folder } from 'lucide-react'
import { call } from '../api'
import { Button } from '../ui/button'
import { cn } from '../ui/cn'
import type { DirectoryEntry, Remote, Translate } from './types'

interface Props {
  root: string
  sessionId?: string
  remote: Remote
  onOpen: (path: string, name: string) => void
  t: Translate
}

type Branch = DirectoryEntry[] | 'loading' | 'error'

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

/** Lazy directory tree over `workspaceFiles.list`; click a file to open a tab. */
export function ExplorerView({ root, sessionId, remote, onOpen, t }: Props) {
  const [branches, setBranches] = React.useState<Record<string, Branch>>({})
  const [menu, setMenu] = React.useState<null | { x: number; y: number; path: string; isDir: boolean }>(null)

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

  const level = (relative: string, depth: number): React.ReactNode => {
    const branch = branches[relative]
    if (branch === undefined || branch === 'loading') {
      return <div className="px-3 py-1 text-2xs text-muted-foreground">{t('explorer.loading')}</div>
    }
    if (branch === 'error') return <div className="px-3 py-1 text-2xs text-muted-foreground">{t('explorer.failed')}</div>
    if (branch.length === 0) {
      return <div className="px-3 py-1 text-2xs text-muted-foreground">{t('explorer.empty')}</div>
    }
    return branch.map((child) => {
      const childPath = relative === '' ? child.name : `${relative}/${child.name}`
      const isDir = child.type === 'directory'
      const open = branches[childPath] !== undefined
      return (
        <React.Fragment key={childPath}>
          <Button
            variant="ghost"
            className={cn('h-[22px] w-full justify-start gap-1 rounded-none px-1 text-xs font-normal')}
            style={{ paddingLeft: 4 + depth * 12 }}
            onClick={() => (isDir ? (open ? collapse(childPath) : load(childPath)) : onOpen(childPath, child.name))}
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

  return (
    <div className="py-1 text-xs">
      <div className="truncate px-3 py-1 text-2xs text-muted-foreground">{root}</div>
      {level('', 0)}
      {menu !== null && (
        <div className="workbench-portal fixed z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 text-xs shadow-lg" style={{ left: menu.x, top: menu.y }}>
          {!menu.isDir && (
            <Button
              variant="ghost"
              className="h-[24px] w-full justify-start px-2 text-xs font-normal"
              onClick={() => {
                onOpen(menu.path, menu.path.split('/').pop() ?? menu.path)
                setMenu(null)
              }}
            >
              {t('explorer.open')}
            </Button>
          )}
          {menu.isDir && (
            <Button
              variant="ghost"
              className="h-[24px] w-full justify-start px-2 text-xs font-normal"
              onClick={() => {
                load(menu.path)
                setMenu(null)
              }}
            >
              {t('explorer.open')}
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
