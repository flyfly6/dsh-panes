import * as React from 'react'
import { AlertCircle, RotateCw, WrapText } from 'lucide-react'
import { highlightToHtml, isDark, languageOf } from '../highlight'
import { Button } from '../ui/button'
import { cn } from '../ui/cn'
import type { Remote, Translate } from './types'

const PAGE = 800

interface Props {
  path: string
  sessionId?: string
  remote: Remote
  t: Translate
  /** 1-based line to reveal after the content renders (search hits, Ctrl+G). */
  line?: number
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; text: string; count: number; eof: boolean }
  | { status: 'error'; message: string }

/** Read-only source view: shiki highlighting, line gutter, wrap toggle, reload. */
export function FileView({ path, sessionId, remote, t, line }: Props) {
  const [state, setState] = React.useState<State>({ status: 'loading' })
  const [wrap, setWrap] = React.useState(false)
  const [token, setToken] = React.useState(0)
  const [dark, setDark] = React.useState(isDark)
  const [html, setHtml] = React.useState<string | null>(null)
  const container = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setDark(isDark()))
    observer.observe(root, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class'] })
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
          setState({ status: 'ready', text: result.value.text, count: result.value.lines, eof: result.value.eof })
        } else {
          const binary = result.error.code.includes('not-text')
          setState({ status: 'error', message: binary ? t('file.binary') : `${t('file.failed')}: ${result.error.code}` })
        }
      })
      .catch((error: Error) => live && setState({ status: 'error', message: error.message }))
    return () => {
      live = false
    }
  }, [path, sessionId, remote, token, t])

  React.useEffect(() => {
    if (state.status !== 'ready') return
    let live = true
    void highlightToHtml(path, state.text).then((result) => live && setHtml(result))
    return () => {
      live = false
    }
  }, [path, state, dark])

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
        const element = container.current?.querySelectorAll('.line')[target - 1] as HTMLElement | undefined
        element?.scrollIntoView({ block: 'center' })
        element?.classList.add('wb-line-active')
        setTimeout(() => element?.classList.remove('wb-line-active'), 1200)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [t])

  // Reveal the requested line once content is painted (search hit / jump to line).
  React.useEffect(() => {
    if (line === undefined || state.status !== 'ready') return
    const target = container.current?.querySelectorAll('.line')[line - 1] as HTMLElement | undefined
    target?.scrollIntoView({ block: 'center' })
    target?.classList.add('wb-line-active')
    return () => target?.classList.remove('wb-line-active')
  }, [line, state, html])

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
      <div ref={container} className="wb-scroll flex-1 overflow-auto">
        {html !== null ? (
          <div
            className={cn('wb-shiki', wrap && 'wb-code-wrap')}
            /* shiki output is markup it generated from file text, not foreign HTML. */
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div className="wb-code flex py-2">
            <div className="select-none border-r border-border px-2 text-right text-muted-foreground" aria-hidden>
              {rows.map((_, index) => (
                <div key={index}>{index + 1}</div>
              ))}
            </div>
            <div className={cn('flex-1 overflow-x-auto whitespace-pre px-3', wrap && 'wb-code-wrap')}>{state.text}</div>
          </div>
        )}
      </div>
      <div className="flex h-status shrink-0 items-center gap-2 border-t border-border bg-card px-2 text-2xs text-muted-foreground">
        <span>{languageOf(path) ?? 'plain'}</span>
        <span>{state.count}</span>
        {!state.eof && <span>…</span>}
        <span className="ml-auto" />
        <Button variant="ghost" size="sm" title="Wrap" onClick={() => setWrap((value) => !value)}>
          <WrapText className={cn('h-3 w-3', wrap && 'text-primary')} aria-hidden />
        </Button>
        <Button variant="ghost" size="sm" title={t('file.reload')} onClick={() => setToken((value) => value + 1)}>
          <RotateCw className="h-3 w-3" aria-hidden />
        </Button>
      </div>
    </div>
  )
}
