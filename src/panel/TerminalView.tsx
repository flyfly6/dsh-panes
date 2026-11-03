import * as React from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import type { Translate } from './types'

/** Model handle the host's terminal service returns (see dsh-api-terminal-controller). */
export interface TerminalModel {
  state: { getSnapshot(): TerminalState; subscribe?(listener: () => void): () => void }
  mount(): () => void
  write(data: string): void
  resize(cols: number, rows: number): void
  acknowledge(revision: number): void
  close(): Promise<void>
}

type Frame =
  | { type: 'snapshot'; sequence: number; screen: string }
  | { type: 'output'; sequence: number; data: string }
  | { type: 'state' | 'ack'; sequence?: number }

interface TerminalState {
  phase: string
  title?: string
  writable: boolean
  render?: { revision: number; frame: Frame }
  error?: string
  issue?: string
}

/** A snapshot is a full screen (reset first); output is an append delta. */
function paint(term: Terminal, render: { revision: number; frame: Frame }, acknowledge: (revision: number) => void): void {
  const frame = render.frame
  if (frame.type === 'snapshot') {
    term.reset()
    term.write(frame.screen, () => acknowledge(render.revision))
  } else if (frame.type === 'output') {
    term.write(frame.data, () => acknowledge(render.revision))
  } else {
    acknowledge(render.revision)
  }
}

/** Live models by `${sessionId}:${tabId}`, so a tab close can end the process. */
const MODELS = new Map<string, TerminalModel>()

export function closeTerminalModel(key: string): void {
  const model = MODELS.get(key)
  if (model === undefined) return
  MODELS.delete(key)
  void model.close().catch(() => undefined)
}

interface Props {
  modelKey: string
  model: TerminalModel
  t: Translate
}

/** Terminal tab: xterm over the host's terminal view model. */
export function TerminalView({ modelKey, model, t }: Props) {
  const host = React.useRef<HTMLDivElement>(null)
  const [phase, setPhase] = React.useState<string>(() => model.state.getSnapshot().phase)
  const [error, setError] = React.useState<string>('')

  React.useEffect(() => {
    MODELS.set(modelKey, model)
    const element = host.current
    if (element === null) return
    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12,
      lineHeight: 1.2,
      theme: { background: '#00000000', selectionBackground: '#3b6ff540' },
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(element)
    const detach = model.mount()
    const dataListener = term.onData((data) => model.write(data))
    const resizeListener = term.onResize(({ cols, rows }) => model.resize(cols, rows))

    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* hidden tab: xterm cannot measure yet */
      }
    })
    observer.observe(element)
    requestAnimationFrame(() => {
      try {
        fit.fit()
      } catch {
        /* ignore */
      }
    })

    const unsubscribe = model.state.subscribe?.(() => {
      const snapshot = model.state.getSnapshot()
      setPhase(snapshot.phase)
      setError(snapshot.error ?? snapshot.issue ?? '')
      if (snapshot.render !== undefined) paint(term, snapshot.render, (revision) => model.acknowledge(revision))
    })
    // First paint: replay whatever the model already had.
    const initial = model.state.getSnapshot()
    if (initial.render !== undefined) paint(term, initial.render, (revision) => model.acknowledge(revision))

    return () => {
      unsubscribe?.()
      dataListener.dispose()
      resizeListener.dispose()
      observer.disconnect()
      detach()
      term.dispose()
      MODELS.delete(modelKey)
    }
  }, [model, modelKey])

  return (
    <div className="relative h-full bg-[var(--background)]">
      <div ref={host} className="h-full w-full px-2 py-1" />
      {phase !== 'connected' && (
        <div className="pointer-events-none absolute bottom-1 right-2 text-2xs text-muted-foreground">
          {phase === 'failed' || phase === 'disconnected' ? (error !== '' ? error : t('terminal.disconnected')) : t('terminal.connecting')}
        </div>
      )}
    </div>
  )
}
