import * as React from 'react'
import { CaseSensitive, ChevronDown, ChevronRight, FileText, Loader2, Regex, Search as SearchIcon, X } from 'lucide-react'
import { call, type ContentHit, type SearchResult } from '../api'
import { Button } from '../ui/button'
import { cn } from '../ui/cn'
import { FileView } from './FileView'
import type { Remote, Translate } from './types'

interface Props {
  root: string
  sessionId?: string
  remote?: Remote
  onOpen: (path: string, line: number) => void
  t: Translate
  autoFocus?: boolean
}

interface Options {
  regex: boolean
  caseSensitive: boolean
  globs: string
}

/** Splits a hit line so the matched span can be marked (literal queries only). */
function Marked({ text, query }: { text: string; query: string }) {
  if (query === '') return <>{text}</>
  const lower = text.toLowerCase()
  const needle = query.toLowerCase()
  const parts: React.ReactNode[] = []
  let from = 0
  for (;;) {
    const at = lower.indexOf(needle, from)
    if (at < 0) break
    if (at > from) parts.push(text.slice(from, at))
    parts.push(
      <mark key={at} className="wb-mark rounded-[2px] px-0 text-foreground">
        {text.slice(at, at + needle.length)}
      </mark>,
    )
    from = at + needle.length
    if (needle === '') break
  }
  parts.push(text.slice(from))
  return <>{parts}</>
}

/** Content search (P6): grouped hits on the left, the matching file on the right. */
export function SearchView({ root, sessionId, remote, onOpen, t, autoFocus }: Props) {
  const [query, setQuery] = React.useState('')
  const [regex, setRegex] = React.useState(false)
  const [caseSensitive, setCaseSensitive] = React.useState(false)
  const [globs, setGlobs] = React.useState('')
  const [result, setResult] = React.useState<SearchResult<ContentHit> | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})
  const [preview, setPreview] = React.useState<{ path: string; line: number; badge: string } | null>(null)
  const abort = React.useRef<AbortController | null>(null)
  const debounce = React.useRef<number | null>(null)

  const run = React.useCallback(
    (value: string, options: Options) => {
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
      const patterns = options.globs.split(',').map((glob) => glob.trim()).filter((glob) => glob !== '')
      call<SearchResult<ContentHit>>(
        'search',
        {
          root,
          mode: 'content',
          query: value,
          regex: options.regex,
          caseSensitive: options.caseSensitive,
          globs: patterns,
        },
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
    [root],
  )

  /* Typing is debounced (R1.10); toggles re-run immediately with the NEW value,
     which is why they pass the options explicitly instead of closing over state. */
  const changeQuery = (value: string) => {
    setQuery(value)
    if (debounce.current !== null) window.clearTimeout(debounce.current)
    debounce.current = window.setTimeout(() => run(value, { regex, caseSensitive, globs }), 250)
  }

  const grouped = React.useMemo(() => {
    const map = new Map<string, ContentHit[]>()
    for (const hit of result?.hits ?? []) {
      const list = map.get(hit.path) ?? []
      list.push(hit)
      map.set(hit.path, list)
    }
    return [...map.entries()]
  }, [result])

  const showHit = (hit: ContentHit, index: number) => {
    const siblings = (result?.hits ?? []).filter((candidate) => candidate.path === hit.path)
    const position = siblings.indexOf(hit) + 1
    setPreview({ path: hit.path, line: hit.line, badge: t('search.matchAt').replace('{i}', String(position)).replace('{n}', String(siblings.length)).replace('{line}', String(hit.line)) })
    void index
  }

  // First hit of a new result set becomes the preview, like the design's "1/2".
  React.useEffect(() => {
    const first = result?.hits?.[0]
    if (first === undefined) {
      setPreview(null)
      return
    }
    showHit(first, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  const segments = preview?.path.split('/') ?? []
  const fileCount = grouped.length

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-tab shrink-0 items-center gap-2 border-b border-border px-3">
        <SearchIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          autoFocus={autoFocus}
          className="h-full min-w-0 flex-1 border-0 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              abort.current?.abort()
              setBusy(false)
            }
          }}
        />
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {result === null
            ? ''
            : t('search.summary')
                .replace('{hits}', String(result.hits.length))
                .replace('{files}', String(fileCount))}
        </span>
        <button
          type="button"
          title={t('search.case')}
          aria-pressed={caseSensitive}
          onClick={() => {
            const next = !caseSensitive
            setCaseSensitive(next)
            run(query, { regex, caseSensitive: next, globs })
          }}
          className={cn('grid h-[22px] w-[26px] place-items-center rounded border text-[11px]', caseSensitive ? 'border-border bg-accent text-foreground' : 'border-transparent text-muted-foreground')}
        >
          Aa
        </button>
        <button
          type="button"
          title={t('search.regex')}
          aria-pressed={regex}
          onClick={() => {
            const next = !regex
            setRegex(next)
            run(query, { regex: next, caseSensitive, globs })
          }}
          className={cn('grid h-[22px] w-[26px] place-items-center rounded border text-[11px]', regex ? 'border-border bg-accent text-foreground' : 'border-transparent text-muted-foreground')}
        >
          .*
        </button>
        <span className="flex h-[22px] shrink-0 items-center gap-1 rounded border border-border px-1.5 text-[10px] text-muted-foreground">
          <input
            className="w-[64px] border-0 bg-transparent text-[10px] text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="src/**"
            value={globs}
            onChange={(event) => setGlobs(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && run(query, { regex, caseSensitive, globs })}
          />
          {globs !== '' && (
            <button type="button" aria-label={t('search.clearGlobs')} onClick={() => { setGlobs(''); run(query, { regex, caseSensitive, globs: '' }) }}>
              <X className="h-2.5 w-2.5" aria-hidden />
            </button>
          )}
        </span>
        <Button
          variant="ghost"
          size="icon"
          title={t('search.clear')}
          onClick={() => {
            abort.current?.abort()
            setQuery('')
            setResult(null)
            setPreview(null)
            setBusy(false)
          }}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[46%] min-w-[280px] flex-col border-r border-border">
          <div className="flex h-[26px] shrink-0 items-center gap-2 border-b border-border px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t('search.results')}
            {busy && <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden />}
            {result?.truncated === true && <span className="ml-auto normal-case tracking-normal">{t('search.truncated')}</span>}
          </div>
          <div className="wb-scroll min-h-0 flex-1 overflow-auto text-xs">
            {error !== '' && <div className="px-3 py-2 text-muted-foreground">{error}</div>}
            {!busy && result !== null && result.hits.length === 0 && error === '' && (
              <div className="px-3 py-2 text-muted-foreground">{t('search.noResults')}</div>
            )}
            {grouped.map(([file, hits]) => {
              const isCollapsed = collapsed[file] === true
              const name = file.split('/').pop() ?? file
              const dir = file.slice(0, Math.max(0, file.length - name.length - 1))
              return (
                <div key={file}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-accent"
                    onClick={() => setCollapsed((prev) => ({ ...prev, [file]: !isCollapsed }))}
                  >
                    {isCollapsed ? <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden /> : <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden />}
                    <FileText className="h-3 w-3 text-[#3B6FF5]" aria-hidden />
                    <span className="truncate text-[11.5px] font-medium text-foreground">{name}</span>
                    <span className="truncate text-[10px] text-muted-foreground">{dir}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{hits.length}</span>
                  </button>
                  {!isCollapsed &&
                    hits.map((hit, index) => (
                      <button
                        key={`${hit.line}:${index}`}
                        type="button"
                        className={cn(
                          'flex w-full items-baseline gap-2 border-l-[3px] border-l-transparent py-[2px] pl-6 pr-3 text-left hover:bg-accent',
                          preview?.path === hit.path && preview.line === hit.line && 'wb-hit-active',
                        )}
                        onClick={() => showHit(hit, index)}
                        onDoubleClick={() => onOpen(hit.path, hit.line)}
                      >
                        <span className="w-6 shrink-0 text-right text-[10px] text-muted-foreground">{hit.line}</span>
                        <span className="truncate font-mono text-[11px]">
                          <Marked text={hit.text} query={regex ? '' : query} />
                        </span>
                      </button>
                    ))}
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-crumb shrink-0 items-center gap-1 overflow-hidden border-b border-border px-3 text-[11px] text-muted-foreground">
            {segments.length === 0 ? (
              <span>{t('search.noPreview')}</span>
            ) : (
              <>
                {segments.map((segment, index) => (
                  <React.Fragment key={`${segment}:${index}`}>
                    {index > 0 && <span className="text-faint">›</span>}
                    <span className={cn('truncate', index === segments.length - 1 && 'text-foreground')}>{segment}</span>
                  </React.Fragment>
                ))}
                <span className="ml-auto shrink-0 text-[10px]">{preview?.badge ?? ''}</span>
              </>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {preview !== null && remote !== undefined && sessionId !== undefined ? (
              <FileView
                key={`${preview.path}:${preview.line}`}
                path={preview.path}
                sessionId={sessionId}
                remote={remote}
                t={t}
                line={preview.line}
              />
            ) : (
              <div className="grid h-full place-content-center px-6 text-center text-xs text-muted-foreground">{t('search.noPreview')}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
