/**
 * The notes list: one row per `.md` in the vault, a search box over titles and
 * bodies, and the verbs that own the file (new, rename, delete).
 */
import * as React from 'react'
import { FileText, MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react'
import { call } from '../api'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Input } from '../ui/input'
import { cn } from '../ui/cn'
import type { Translate } from '../panel/types'

interface NoteEntry {
  path: string
  title: string
  updatedAt: number
  size: number
  excerpt: string
}

interface Hit {
  path: string
  title: string
  line: number
  snippet: string
}

type Sort = 'updated' | 'title'

export function NotesList({ t, open }: { t: Translate; open: (path: string) => void }) {
  const [notes, setNotes] = React.useState<NoteEntry[]>([])
  const [vaultPath, setVaultPath] = React.useState('')
  const [query, setQuery] = React.useState('')
  const [hits, setHits] = React.useState<Hit[] | null>(null)
  const [sort, setSort] = React.useState<Sort>('updated')
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(() => {
    call<{ vaultPath: string; notes: NoteEntry[] }>('notes.list')
      .then((data) => {
        setNotes(data.notes)
        setVaultPath(data.vaultPath)
        setError('')
      })
      .catch((failure: Error) => setError(failure.message))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  React.useEffect(() => {
    if (query.trim() === '') {
      setHits(null)
      return undefined
    }
    const timer = window.setTimeout(() => {
      call<{ hits: Hit[] }>('notes.search', { query })
        .then((data) => setHits(data.hits))
        .catch(() => setHits([]))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [query])

  const create = async () => {
    setBusy(true)
    try {
      const created = await call<{ path: string }>('notes.create', { title: t('notes.untitledNew') })
      load()
      open(created.path)
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const rename = async (note: NoteEntry) => {
    const title = window.prompt(t('notes.renamePrompt'), note.title)
    if (title === null || title.trim() === '') return
    try {
      const renamed = await call<{ path: string }>('notes.rename', { path: note.path, title: title.trim() })
      load()
      if (note.path !== renamed.path) open(renamed.path)
    } catch (failure) {
      setError((failure as Error).message)
    }
  }

  const remove = async (note: NoteEntry) => {
    if (!window.confirm(`${t('notes.deleteConfirm')}\n\n${note.title}`)) return
    try {
      await call('notes.delete', { path: note.path })
      load()
    } catch (failure) {
      setError((failure as Error).message)
    }
  }

  const sorted = React.useMemo(() => {
    const list = notes.slice()
    if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title))
    return list
  }, [notes, sort])

  const rows: NoteEntry[] =
    hits === null
      ? sorted
      : hits.map((hit) => {
          const known = notes.find((note) => note.path === hit.path)
          return {
            path: hit.path,
            title: hit.title,
            updatedAt: known?.updatedAt ?? 0,
            size: known?.size ?? 0,
            excerpt: hit.snippet,
          }
        })

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-tab shrink-0 items-center gap-1.5 border-b border-border px-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <Input
          className="h-7 flex-1 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
          placeholder={t('notes.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
        <Button
          variant="ghost"
          size="sm"
          className="text-2xs"
          title={t('notes.sort')}
          onClick={() => setSort((value) => (value === 'updated' ? 'title' : 'updated'))}
        >
          {sort === 'updated' ? t('notes.sort.updated') : t('notes.sort.title')}
        </Button>
        <span className="shrink-0 text-[10px] text-muted-foreground" title={vaultPath}>
          {t('notes.count').replace('{n}', String(notes.length))}
        </span>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void create()}>
          <Plus className="h-3 w-3" aria-hidden /> {t('notes.new')}
        </Button>
      </div>
      {error !== '' && <div className="px-3 py-2 text-xs text-destructive">{error}</div>}
      <div className="wb-scroll min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="grid place-content-center gap-2 px-6 py-10 text-center text-muted-foreground">
            <strong className="text-sm text-foreground">{hits === null ? t('notes.empty') : t('notes.noHits')}</strong>
            <span className="text-xs">{hits === null ? t('notes.emptyHint') : t('notes.noHitsHint')}</span>
          </div>
        ) : (
          rows.map((note) => (
            <div
              key={note.path}
              className="group flex items-start gap-2 border-b border-border px-3 py-2 hover:bg-accent"
            >
              <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => open(note.path)}>
                <div className="truncate text-xs text-foreground">{note.title}</div>
                <div className="truncate text-2xs text-muted-foreground">{note.excerpt === '' ? note.path : note.excerpt}</div>
              </button>
              <span className="shrink-0 text-2xs text-muted-foreground">{formatDate(note.updatedAt)}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100" title={t('notes.more')}>
                    <MoreHorizontal className="h-3 w-3" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => void rename(note)}>{t('notes.rename')}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void remove(note)}>
                    <span className="flex items-center gap-2">
                      <Trash2 className="h-3 w-3" aria-hidden /> {t('notes.delete')}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function formatDate(ms: number): string {
  if (ms === 0) return ''
  const date = new Date(ms)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  return `${date.getMonth() + 1}/${date.getDate()}`
}
