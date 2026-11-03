import * as React from 'react'
import { ArrowLeft, ArrowRight, Globe, RotateCw } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import type { Translate } from './types'

interface Props {
  url: string
  t: Translate
  onNavigate?: (url: string) => void
}

function normalize(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^[\w-]+(\.[\w-]+)+/.test(trimmed)) return `https://${trimmed}`
  return ''
}

/**
 * Browser tab: an iframe with its own history and address bar.
 *
 * ponytail: an iframe is the only programmable surface here — a Desktop `<webview>`
 * is not creatable from a client plugin (S8). Sites that refuse framing show the
 * hint below; opening them in the system browser is the fallback.
 */
export function BrowserView({ url, t, onNavigate }: Props) {
  const [history, setHistory] = React.useState<string[]>([url])
  const [index, setIndex] = React.useState(0)
  const [draft, setDraft] = React.useState(url)
  const [reload, setReload] = React.useState(0)
  const current = history[index] ?? ''

  const go = (next: string) => {
    const target = normalize(next)
    if (target === '') return
    setHistory((prev) => [...prev.slice(0, index + 1), target])
    setIndex((prev) => prev + 1)
    setDraft(target)
    onNavigate?.(target)
  }

  React.useEffect(() => {
    setDraft(url)
  }, [url])

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        <Button variant="ghost" size="icon" disabled={index === 0} onClick={() => setIndex((prev) => Math.max(0, prev - 1))} title={t('browser.back')}>
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button variant="ghost" size="icon" disabled={index >= history.length - 1} onClick={() => setIndex((prev) => Math.min(history.length - 1, prev + 1))} title={t('browser.forward')}>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setReload((value) => value + 1)} title={t('browser.reload')}>
          <RotateCw className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <form
          className="flex flex-1 items-center"
          onSubmit={(event) => {
            event.preventDefault()
            go(draft)
          }}
        >
          <Input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t('browser.placeholder')} spellCheck={false} />
        </form>
      </div>
      {current === '' || current === 'about:blank' ? (
        <div className="grid flex-1 place-items-center text-xs text-muted-foreground">
          <div className="flex flex-col items-center gap-2">
            <Globe className="h-5 w-5" aria-hidden />
            {t('browser.empty')}
          </div>
        </div>
      ) : (
        <iframe
          key={`${current}:${reload}`}
          src={current}
          title={current}
          className="flex-1 border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
          referrerPolicy="no-referrer"
        />
      )}
      {current !== '' && current !== 'about:blank' && (
        <div className="shrink-0 border-t border-border px-2 py-1 text-2xs text-muted-foreground">{t('browser.framingHint')}</div>
      )}
    </div>
  )
}
