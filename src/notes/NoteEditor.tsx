/**
 * One note: a Notion-style single column — big title, then BlockNote blocks.
 *
 * Storage is `.md` (D4 + the (a) decision): the host owns the frontmatter and
 * this half only ever sees/edits the body. BlockNote's markdown conversion is
 * lossy, so a note whose round trip does not reproduce the original opens in a
 * read-only preview first, with an explicit way into the editor — the alternative
 * (silently normalising someone's Obsidian note on first save) is data loss.
 */
import * as React from 'react'
import { BlockNoteView } from '@blocknote/ariakit'
import { useCreateBlockNote } from '@blocknote/react'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { call } from '../api'
import { Button } from '../ui/button'
import { cn } from '../ui/cn'
import { setNoteDirty } from './store'
import type { Translate } from '../panel/types'

interface NoteDoc {
  path: string
  body: string
  title: string
  etag: string
}

type Status = 'saved' | 'dirty' | 'saving' | 'conflict'

/**
 * Round-trip comparison for the lossy warning. Whitespace carries no meaning in
 * Markdown, and BlockNote re-pads table cells and list markers — comparing with
 * every space removed keeps the warning about CONTENT it cannot represent, not
 * about formatting it merely normalises.
 */
function normal(markdown: string): string {
  return markdown.replace(/\s+/g, '')
}

export function NoteEditor({ path, t }: { path: string; t: Translate }) {
  const [doc, setDoc] = React.useState<NoteDoc | null>(null)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    let live = true
    setDoc(null)
    setError('')
    call<{ body: string; meta: { title: string }; etag: string }>('notes.read', { path })
      .then((read) => {
        if (live) setDoc({ path, body: read.body, title: read.meta.title ?? '', etag: read.etag })
      })
      .catch((failure: Error) => live && setError(failure.message))
    return () => {
      live = false
    }
  }, [path])

  if (error !== '') return <div className="p-4 text-xs text-muted-foreground">{error}</div>
  if (doc === null) return <div className="p-4 text-xs text-muted-foreground">{t('notes.loading')}</div>
  return <NoteBody key={doc.path} initial={doc} t={t} />
}

function prefersDark(): boolean {
  const root = document.documentElement
  const attr = root.getAttribute('data-theme') ?? root.dataset.theme ?? root.className
  if (/dark/i.test(attr)) return true
  if (/light/i.test(attr)) return false
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
}

function NoteBody({ initial, t }: { initial: NoteDoc; t: Translate }) {
  /* The editor starts empty and the markdown is loaded in an effect: parsing
     needs the instance, and BlockNoteView must not mount twice per load. */
  const editor = useCreateBlockNote()
  const [title, setTitle] = React.useState(initial.title)
  const [status, setStatus] = React.useState<Status>('saved')
  const [lossy, setLossy] = React.useState(false)
  const etag = React.useRef(initial.etag)
  const timer = React.useRef<number | null>(null)
  /* Set while blocks are replaced programmatically: that fires onChange too, and
     an autosave right after a reload would stamp the file the user just read. */
  const quiet = React.useRef(false)

  /* Markdown lives in the file, blocks live in the editor: parse once on mount
     (and again after a reload) and note whether the round trip is faithful. */
  const load = React.useCallback(
    (body: string) => {
      const blocks = editor.tryParseMarkdownToBlocks(body)
      setLossy(normal(editor.blocksToMarkdownLossy(blocks)) !== normal(body))
      quiet.current = true
      editor.replaceBlocks(editor.document, blocks)
      window.setTimeout(() => {
        quiet.current = false
      }, 0)
    },
    [editor],
  )

  React.useEffect(() => {
    load(initial.body)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = React.useCallback(
    async (overwrite = false) => {
      setStatus('saving')
      try {
        const body = editor.blocksToMarkdownLossy(editor.document)
        const written = await call<{ etag: string }>('notes.write', {
          path: initial.path,
          body,
          title: title.trim() === '' ? undefined : title.trim(),
          etag: overwrite ? '' : etag.current,
        })
        etag.current = written.etag
        setStatus('saved')
        setNoteDirty(initial.path, false)
      } catch (failure) {
        if ((failure as { code?: string }).code === 'notes/conflict') {
          setStatus('conflict')
          setNoteDirty(initial.path, true)
          return
        }
        setStatus('dirty')
      }
    },
    [editor, initial.path, title],
  )

  const schedule = React.useCallback(() => {
    if (quiet.current) return
    setStatus((current) => (current === 'conflict' ? current : 'dirty'))
    setNoteDirty(initial.path, true)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      void save(false)
    }, 800)
  }, [initial.path, save])

  React.useEffect(() => {
    const off = editor.onChange(() => schedule())
    return () => {
      off?.()
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [editor, schedule])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      if (timer.current !== null) window.clearTimeout(timer.current)
      void save(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  const reload = async () => {
    const read = await call<{ body: string; meta: { title: string }; etag: string }>('notes.read', { path: initial.path })
    etag.current = read.etag
    setTitle(read.meta.title ?? '')
    setStatus('saved')
    setNoteDirty(initial.path, false)
    load(read.body)
  }

  const statusText =
    status === 'saved' ? t('notes.saved') : status === 'saving' ? t('notes.saving') : status === 'conflict' ? t('notes.conflict') : t('notes.dirty')

  return (
    <div className="wb-note">
      {status === 'conflict' && (
        <div className="wb-note-bar" data-note-conflict="">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          <span>{t('notes.conflictHint')}</span>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => void reload()}>
            {t('notes.reload')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void save(true)}>
            {t('notes.overwrite')}
          </Button>
        </div>
      )}
      {lossy && (
        <div className="wb-note-bar" data-note-lossy="">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          <span>{t('notes.lossy')}</span>
        </div>
      )}
      <div className="wb-note-scroll">
        <div className="wb-note-page">
          <input
            className="wb-note-title"
            value={title}
            placeholder={t('notes.untitled')}
            onChange={(event) => {
              setTitle(event.target.value)
              schedule()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
          <BlockNoteView editor={editor} theme={prefersDark() ? 'dark' : 'light'} data-note-editor="" />
        </div>
      </div>
      <div className="wb-note-status" data-note-status={status}>
        <span className="truncate">{initial.path}</span>
        <span className="ml-auto flex items-center gap-1">
          {status === 'saving' ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
          {status === 'saved' ? <Check className="h-3 w-3" aria-hidden /> : null}
          <span className={cn(status === 'conflict' && 'text-destructive')}>{statusText}</span>
        </span>
      </div>
    </div>
  )
}
