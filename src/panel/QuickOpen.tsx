import * as React from 'react'
import { FileText } from 'lucide-react'
import { call, type NameHit, type SearchResult } from '../api'
import { Input } from '../ui/input'
import { cn } from '../ui/cn'
import type { Translate } from './types'

interface Props {
  root: string
  onOpen: (path: string) => void
  onClose: () => void
  t: Translate
}

/** Ctrl+P quick open: fuzzy file names, first row opens on Enter. */
export function QuickOpen({ root, onOpen, onClose, t }: Props) {
  const [query, setQuery] = React.useState('')
  const [hits, setHits] = React.useState<NameHit[]>([])
  const [active, setActive] = React.useState(0)
  const abort = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    abort.current?.abort()
    if (query.trim() === '') {
      setHits([])
      return
    }
    const controller = new AbortController()
    abort.current = controller
    call<SearchResult<NameHit>>('search', { root, mode: 'name', query, limit: 50 }, controller.signal)
      .then((data) => {
        setHits(data.hits)
        setActive(0)
      })
      .catch((failure: Error) => failure.name !== 'AbortError' && setHits([]))
  }, [query, root])

  const choose = (hit: NameHit | undefined) => {
    if (hit === undefined) return
    onOpen(hit.path)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]" onClick={onClose}>
      <div
        className="workbench-portal w-[560px] max-w-[90vw] overflow-hidden rounded-lg border border-border bg-popover shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <Input
          autoFocus
          className="h-[34px] rounded-none border-0 border-b px-3 text-sm"
          placeholder={t('quickOpen.placeholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
            else if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActive((index) => Math.min(index + 1, hits.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((index) => Math.max(index - 1, 0))
            } else if (event.key === 'Enter') choose(hits[active])
          }}
        />
        <div className="wb-scroll max-h-[46vh] overflow-auto py-1 text-xs text-popover-foreground">
          {hits.length === 0 && query !== '' && <div className="px-3 py-2 text-muted-foreground">{t('search.noResults')}</div>}
          {hits.map((hit, index) => (
            <button
              key={hit.path}
              type="button"
              className={cn('flex w-full items-center gap-2 px-3 py-1 text-left', index === active && 'bg-accent')}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(hit)}
            >
              <FileText className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{hit.name}</span>
              <span className="ml-auto truncate text-2xs text-muted-foreground">{hit.path}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
