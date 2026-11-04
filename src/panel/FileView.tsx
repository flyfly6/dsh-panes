import * as React from 'react'
import { AlertCircle, Pencil, RotateCw, Save, WrapText } from 'lucide-react'
import { ApiCallError, call } from '../api'
import { highlightToHtml, isDark, languageLabel, languageOf } from '../highlight'
import { Button } from '../ui/button'
import { cn } from '../ui/cn'
import type { Remote, Translate } from './types'

const PAGE = 800

export interface Cursor {
  line: number
  col: number
}

interface Props {
  path: string
  sessionId?: string
  remote: Remote
  t: Translate
  /** 1-based line to reveal after the content renders (search hits, Ctrl+G). */
  line?: number
  /** Changes on every open request, so the same line reveals again. */
  stamp?: number
  /** Report the line/column under the pointer for the status bar. */
  onCursor?: (cursor: Cursor) => void
  /** Absolute workspace root; without it the tab stays read-only. */
  root?: string
}

interface EditState {
  draft: string
  /** Version this draft was loaded from; a mismatch is a conflict, not an overwrite. */
  etag: string
  saved: string
  saving: boolean
  /** The disk copy handed back by a 409, shown in the conflict bar. */
  conflict: string | null
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; text: string; count: number; eof: boolean; loadingMore: boolean }
  | { status: 'error'; message: string }

/** Column of a caret range inside one rendered line (character offset + 1). */
function columnAt(line: HTMLElement, range: Range): number {
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
  let column = 0
  let node = walker.nextNode()
  while (node !== null) {
    const text = node as Text
    if (text === range.startContainer) return column + range.startOffset + 1
    column += text.data.length
    node = walker.nextNode()
  }
  return 1
}

/** Read-only source view: shiki highlighting, line gutter, wrap toggle, paging. */
export function FileView({ path, sessionId, remote, t, line, stamp, onCursor, root }: Props) {
  const [state, setState] = React.useState<State>({ status: 'loading' })
  const [wrap, setWrap] = React.useState(false)
  const [token, setToken] = React.useState(0)
  const [dark, setDark] = React.useState(isDark)
  const [html, setHtml] = React.useState<string | null>(null)
  const [edit, setEdit] = React.useState<EditState | null>(null)
  const container = React.useRef<HTMLDivElement>(null)
  const lineNodes = React.useRef<HTMLElement[]>([])
  const hovered = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setDark(isDark()))
    const options: MutationObserverInit = { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class', 'style'] }
    observer.observe(root, options)
    observer.observe(document.body, options)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    if (sessionId === undefined) {
      setState({ status: 'error', message: t('file.failed') })
      return
    }
    let live = true
    setState({ status: 'loading' })
    setHtml(null)
    remote.workspaceFiles
      .read(sessionId, path, { offset: 1, limit: PAGE })
      .then((result) => {
        if (!live) return
        if (result.ok) {
          setState({ status: 'ready', text: result.value.text, count: result.value.lines, eof: result.value.eof, loadingMore: false })
          onCursor?.({ line: 1, col: 1 })
        } else {
          const binary = result.error.code.includes('not-text')
          setState({ status: 'error', message: binary ? t('file.binary') : `${t('file.failed')}: ${result.error.code}` })
        }
      })
      .catch((error: Error) => live && setState({ status: 'error', message: error.message }))
    return () => {
      live = false
    }
  }, [path, sessionId, remote, token, t, onCursor])

  /* R1.11: a file longer than one page appends the next page on demand. */
  const loadMore = React.useCallback(() => {
    if (state.status !== 'ready' || state.eof || state.loadingMore || sessionId === undefined) return
    const start = state.text.split('\n').length
    setState({ ...state, loadingMore: true })
    remote.workspaceFiles
      .read(sessionId, path, { offset: start + 1, limit: PAGE })
      .then((result) => {
        if (!result.ok) return setState({ ...state, loadingMore: false })
        const next = `${state.text}${state.text.endsWith('\n') ? '' : '\n'}${result.value.text}`
        setState({ status: 'ready', text: next, count: start + result.value.lines - 1, eof: result.value.eof, loadingMore: false })
      })
      .catch(() => setState({ ...state, loadingMore: false }))
  }, [path, remote, sessionId, state])

  React.useEffect(() => {
    if (state.status !== 'ready') return
    let live = true
    void highlightToHtml(path, state.text).then((result) => live && setHtml(result))
    return () => {
      live = false
    }
  }, [path, state, dark])

  /* Cache the per-line nodes: reveal and cursor reporting both walk them. */
  React.useEffect(() => {
    const host = container.current
    if (host === null) return
    lineNodes.current = [...host.querySelectorAll<HTMLElement>('.line, [data-line]')]
  }, [html, state])

  const reveal = React.useCallback((target: number) => {
    const host = container.current
    if (host === null) return
    const nodes = lineNodes.current.length > 0 ? lineNodes.current : [...host.querySelectorAll<HTMLElement>('.line, [data-line]')]
    const element = nodes[target - 1]
    if (element === undefined) return
    element.scrollIntoView({ block: 'center' })
    element.classList.add('wb-line-active')
  }, [])

  // Alt+Z toggles wrap; Ctrl+G jumps to a line (R1.11).
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        setWrap((value: boolean) => !value)
        return
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'g') {
        event.preventDefault()
        const answer = window.prompt(t('file.gotoLine'))
        const target = Number(answer)
        if (answer === null || !Number.isFinite(target) || target < 1) return
        reveal(target)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reveal, t])

  // Reveal the requested line once content is painted (search hit / jump). The
  // stamp in the deps is what makes a second click on the same hit scroll again.
  React.useEffect(() => {
    if (line === undefined || state.status !== 'ready') return
    reveal(line)
  }, [line, stamp, state, html, reveal])


  const beginEdit = React.useCallback(async () => {
    if (root === undefined || state.status !== 'ready' || !state.eof) return
    const info = await call<{ etag: string }>('file.stat', { root, path }).catch(() => null)
    setEdit({ draft: state.text, etag: info?.etag ?? '', saved: state.text, saving: false, conflict: null })
  }, [path, root, state])

  const save = React.useCallback(
    async (force = false) => {
      if (edit === null || root === undefined || edit.saving) return
      setEdit({ ...edit, saving: true, conflict: null })
      try {
        const result = await call<{ etag: string }>('file.write', { root, path, content: edit.draft, etag: force ? '' : edit.etag })
        setEdit((current) => (current === null ? null : { ...current, etag: result.etag, saved: current.draft, saving: false, conflict: null }))
        setState((current) => (current.status === 'ready' ? { ...current, text: edit.draft } : current))
      } catch (error) {
        const failure = error as ApiCallError
        let disk: string | null = null
        if (failure.code === 'files/conflict') {
          try {
            disk = (JSON.parse(failure.message) as { current?: string }).current ?? ''
          } catch {
            disk = ''
          }
        }
        setEdit((current) => (current === null ? null : { ...current, saving: false, conflict: failure.code === 'files/conflict' ? disk : null }))
        if (failure.code !== 'files/conflict') setState({ status: 'error', message: `${t('file.saveFailed')}: ${failure.code}` })
      }
    },
    [edit, path, root, t],
  )

  /* ⌘S saves while editing; the panel's other shortcuts must not fire inside it. */
  React.useEffect(() => {
    if (edit === null) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      } else if (event.key === 'Escape') {
        setEdit(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [edit, save])

  const reportCursor = (event: React.MouseEvent<HTMLDivElement>) => {
    if (onCursor === undefined) return
    const host = container.current
    if (host === null) return
    const target = (event.target as HTMLElement).closest('.line, [data-line]') as HTMLElement | null
    if (target === null) return
    const nodes = lineNodes.current.length > 0 ? lineNodes.current : [...host.querySelectorAll<HTMLElement>('.line, [data-line]')]
    const index = nodes.indexOf(target)
    if (index < 0) return
    if (hovered.current !== target) {
      hovered.current?.classList.remove('wb-line-hover')
      target.classList.add('wb-line-hover')
      hovered.current = target
    }
    let col = 1
    const caret = (document as unknown as { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(
      event.clientX,
      event.clientY,
    )
    if (caret != null && target.contains(caret.startContainer)) col = columnAt(target, caret)
    onCursor({ line: index + 1, col })
  }

  if (state.status === 'loading') {
    return <div className="grid h-full place-items-center text-xs text-muted-foreground">{t('file.loading')}</div>
  }
  if (state.status === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
        <AlertCircle className="h-4 w-4" aria-hidden />
        <span>{state.message}</span>
        <Button variant="outline" size="sm" onClick={() => setToken((value) => value + 1)}>
          <RotateCw className="h-3 w-3" aria-hidden /> {t('file.reload')}
        </Button>
      </div>
    )
  }

  const rows = state.text.split('\n')
  return (
    <div className="flex h-full flex-col">
      {edit !== null && (
        <div className="flex min-h-0 flex-1 flex-col">
          {edit.conflict !== null && (
            <div className="flex shrink-0 items-center gap-2 border-b border-border bg-[var(--card)] px-2 py-1 text-2xs text-foreground">
              <AlertCircle className="h-3 w-3 text-primary" aria-hidden />
              <span className="flex-1">{t('file.conflict')}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEdit({ draft: edit.conflict ?? '', etag: '', saved: edit.conflict ?? '', saving: false, conflict: null })
                  setState((current) => (current.status === 'ready' ? { ...current, text: edit.conflict ?? '' } : current))
                }}
              >
                {t('file.reloadDisc')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void save(true)}>
                {t('file.keepMine')}
              </Button>
            </div>
          )}
          <textarea
            aria-label={t('file.editing')}
            className="wb-code wb-scroll min-h-0 flex-1 resize-none whitespace-pre bg-[var(--background)] p-2 text-foreground outline-none"
            spellCheck={false}
            value={edit.draft}
            onChange={(event) => setEdit({ ...edit, draft: event.target.value })}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </div>
      )}
      <div
        ref={container}
        className={cn('wb-scroll min-h-0 flex-1 overflow-auto', edit !== null && 'hidden')}
        onMouseMove={reportCursor}
      >
        {html !== null ? (
          <div
            className={cn('wb-shiki', wrap && 'wb-code-wrap')}
            /* shiki output is markup it generated from file text, not foreign HTML. */
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div className={cn('wb-code py-2', wrap && 'wb-code-wrap')}>
            {rows.map((row, index) => (
              <div key={index} className="wb-src-line" data-line={index + 1}>
                <span className="wb-src-num">{index + 1}</span>
                <span className="wb-src-text">{row === '' ? ' ' : row}</span>
              </div>
            ))}
          </div>
        )}
        {!state.eof && (
          <div className="flex justify-center py-3">
            <Button variant="outline" size="sm" disabled={state.loadingMore} onClick={loadMore}>
              {state.loadingMore ? t('file.loading') : t('file.loadMore')}
            </Button>
          </div>
        )}
      </div>
      <div className="flex h-status shrink-0 items-center gap-2 border-t border-border bg-[var(--card)] px-2 text-2xs text-muted-foreground">
        <span>{languageLabel(path)}</span>
        <span>{edit !== null ? (edit.draft === edit.saved ? t('file.saved') : t('file.modified')) : state.count}</span>
        <span className="ml-auto" />
        {edit !== null ? (
          <>
            <Button variant="ghost" size="sm" title={t('file.save')} onClick={() => void save()}>
              <Save className={cn('h-3 w-3', edit.draft !== edit.saved && 'text-primary')} aria-hidden />
            </Button>
            <Button variant="ghost" size="sm" title={t('file.stopEdit')} onClick={() => setEdit(null)}>
              {t('file.readOnly')}
            </Button>
          </>
        ) : (
          root !== undefined &&
          state.eof && (
            <Button variant="ghost" size="sm" title={t('file.edit')} onClick={() => void beginEdit()}>
              <Pencil className="h-3 w-3" aria-hidden />
            </Button>
          )
        )}
        <Button variant="ghost" size="sm" title={t('file.wrap')} onClick={() => setWrap((value) => !value)}>
          <WrapText className={cn('h-3 w-3', wrap && 'text-primary')} aria-hidden />
        </Button>
        <Button variant="ghost" size="sm" title={t('file.reload')} onClick={() => setToken((value) => value + 1)}>
          <RotateCw className="h-3 w-3" aria-hidden />
        </Button>
      </div>
    </div>
  )
}

export { languageOf }
