import * as React from 'react'
import { CaseSensitive, Loader2, Regex, Search as SearchIcon } from 'lucide-react'
import { call, type ContentHit, type SearchResult } from '../api'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { cn } from '../ui/cn'
import type { Translate } from './types'

interface Props {
  root: string
  onOpen: (path: string, line: number) => void
  t: Translate
  autoFocus?: boolean
}

/** Content search: grouped hits, abortable per keystroke, capped by the host. */
export function SearchView({ root, onOpen, t, autoFocus }: Props) {
  const [query, setQuery] = React.useState('')
  const [regex, setRegex] = React.useState(false)
  const [caseSensitive, setCaseSensitive] = React.useState(false)
  const [globs, setGlobs] = React.useState('')
  const [result, setResult] = React.useState<SearchResult<ContentHit> | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const abort = React.useRef<AbortController | null>(null)

  const run = React.useCallback(
    (value: string) => {
      abort.current?.abort()
      if (value.trim() === '') {
        setResult(null)
        setBusy(false)
        setError('')
        return
      }
      const controller = new AbortController()
      abort.current = controller
      setBusy(true)
      setError('')
      const patterns = globs.split(',').map((glob) => glob.trim()).filter((glob) => glob !== '')
      call<SearchResult<ContentHit>>(
        'search',
        { root, mode: 'content', query: value, regex, caseSensitive, globs: patterns },
        controller.signal,
      )
        .then((data) => {
          setResult(data)
          setBusy(false)
        })
        .catch((failure: Error) => {
          if (failure.name === 'AbortError') return
          setError(failure.message)
          setBusy(false)
        })
    },
    [caseSensitive, globs, regex, root],
  )

  const grouped = React.useMemo(() => {
    const map = new Map<string, ContentHit[]>()
    for (const hit of result?.hits ?? []) {
      const list = map.get(hit.path) ?? []
      list.push(hit)
      map.set(hit.path, list)
    }
    return [...map.entries()]
  }, [result])

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        <Input
          autoFocus={autoFocus}
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            run(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              abort.current?.abort()
              setBusy(false)
            }
          }}
        />
        <Button
          variant={caseSensitive ? 'outline' : 'ghost'}
          size="icon"
          title={t('search.case')}
          onClick={() => {
            setCaseSensitive((value) => !value)
            run(query)
          }}
        >
          <CaseSensitive className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Input
          className="max-w-[180px]"
          placeholder={t('search.globs')}
          value={globs}
          onChange={(event) => setGlobs(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && run(query)}
        />
        <Button
          variant={regex ? 'outline' : 'ghost'}
          size="icon"
          title={t('search.regex')}
          onClick={() => {
            setRegex((value) => !value)
            run(query)
          }}
        >
          <Regex className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      <div className="wb-scroll min-h-0 flex-1 overflow-auto text-xs">
        {busy && (
          <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> {t('search.searching')}
          </div>
        )}
        {error !== '' && <div className="px-3 py-2 text-muted-foreground">{error}</div>}
        {!busy && result !== null && result.hits.length === 0 && error === '' && (
          <div className="px-3 py-2 text-muted-foreground">{t('search.noResults')}</div>
        )}
        {result !== null && result.hits.length > 0 && (
          <div className="border-b border-border px-3 py-1 text-2xs text-muted-foreground">
            {result.hits.length} {t('search.hits')}
            {result.truncated ? ` · ${t('search.truncated')}` : ''}
          </div>
        )}
        {grouped.map(([file, hits]) => (
          <div key={file}>
            <div className="sticky top-0 flex items-center gap-1 bg-card px-3 py-1 text-2xs text-muted-foreground">
              <SearchIcon className="h-2.5 w-2.5" aria-hidden />
              <span className="truncate">{file}</span>
              <span className="ml-auto">{hits.length}</span>
            </div>
            {hits.map((hit, index) => (
              <button
                key={`${hit.line}:${index}`}
                type="button"
                className={cn(
                  'flex w-full items-baseline gap-2 border-l-[3px] border-l-transparent px-3 py-[2px] text-left font-mono text-xs hover:bg-accent',
                )}
                onClick={() => onOpen(hit.path, hit.line)}
              >
                <span className="w-8 shrink-0 text-right text-2xs text-muted-foreground">{hit.line}</span>
                <span className="truncate">{hit.text}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
