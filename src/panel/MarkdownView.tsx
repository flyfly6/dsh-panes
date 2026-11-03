import * as React from 'react'
import { Code2, Eye } from 'lucide-react'
import { highlightCode } from '../highlight'
import { highlightCodeBlocks, renderMarkdown, resolveImages } from '../markdown'
import { Button } from '../ui/button'
import { cn } from '../ui/cn'
import { FileView } from './FileView'
import type { Remote, Translate } from './types'

interface Props {
  path: string
  sessionId?: string
  remote: Remote
  t: Translate
  line?: number
}

type Mode = 'preview' | 'source'

/** `.md`/`.mdx` renders as GFM by default; Ctrl+Shift+V or the toggle shows source. */
export function MarkdownView({ path, sessionId, remote, t, line }: Props) {
  const [mode, setMode] = React.useState<Mode>('preview')
  const [html, setHtml] = React.useState<string | null>(null)
  const [error, setError] = React.useState('')
  const container = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (sessionId === undefined) {
      setError(t('file.failed'))
      return
    }
    let live = true
    setHtml(null)
    setError('')
    remote.workspaceFiles
      .read(sessionId, path, { offset: 1, limit: 5000 })
      .then((result) => {
        if (!live) return
        if (result.ok) setHtml(renderMarkdown(result.value.text))
        else setError(result.error.code === 'workspace-file/not-text' ? t('file.binary') : `${t('file.failed')}: ${result.error.code}`)
      })
      .catch((failure: Error) => live && setError(failure.message))
    return () => {
      live = false
    }
  }, [path, sessionId, remote, t])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        setMode((value) => (value === 'preview' ? 'source' : 'preview'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  React.useEffect(() => {
    const element = container.current
    if (element === null || html === null || mode !== 'preview') return
    const baseDir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const readBytes = sessionId === undefined
      ? undefined
      : async (target: string) => {
          const api = (remote.workspaceFiles as any).readBytes
          if (typeof api !== 'function') return null
          const result = await api(sessionId, target, {})
          return result?.ok === true ? (result.value.data as Uint8Array) : null
        }
    void resolveImages(element, baseDir, readBytes)
    void highlightCodeBlocks(element, highlightCode)
  }, [html, mode, path, remote, sessionId])

  if (mode === 'source') {
    return (
      <div className="flex h-full flex-col">
        <div className="flex h-[26px] shrink-0 items-center justify-end gap-1 border-b border-border bg-card px-2">
          <Button variant="ghost" size="sm" onClick={() => setMode('preview')}>
            <Eye className="h-3 w-3" aria-hidden /> {t('markdown.preview')}
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <FileView path={path} sessionId={sessionId} remote={remote} t={t} line={line} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[26px] shrink-0 items-center justify-end gap-1 border-b border-border bg-card px-2">
        <Button variant="ghost" size="sm" onClick={() => setMode('source')}>
          <Code2 className="h-3 w-3" aria-hidden /> {t('markdown.source')}
        </Button>
      </div>
      <div className="wb-scroll min-h-0 flex-1 overflow-auto">
        {error !== '' ? (
          <div className="p-3 text-xs text-muted-foreground">{error}</div>
        ) : html === null ? (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">{t('file.loading')}</div>
        ) : (
          <div
            ref={container}
            className={cn('wb-markdown px-6 py-4 text-base')}
            /* sanitized by DOMPurify inside renderMarkdown() */
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  )
}
