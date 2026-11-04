/**
 * One note: a Notion-style single column — big title, then BlockNote blocks.
 *
 * Storage is `.md` (D4 + the (a) decision): the host owns the frontmatter and
 * this half only ever sees/edits the body. BlockNote's markdown conversion is
 * lossy, so a note whose round trip does not reproduce the original gets a banner
 * saying so (still editable) — silently normalising someone's Obsidian note on
 * the first save is the thing we are avoiding.
 */
import * as React from 'react'
import { BlockNoteView } from '@blocknote/ariakit'
import { useCreateBlockNote } from '@blocknote/react'
import { AlertTriangle } from 'lucide-react'
import { call } from '../api'
import { Button } from '../ui/button'
import { isDark } from '../highlight'
import { setNoteDirty, setNoteStatus } from './store'
import type { Translate } from '../panel/types'

interface NoteDoc {
  path: string
  body: string
  title: string
  etag: string
  tags: string[]
  updated: string
}

type Status = 'saved' | 'dirty' | 'saving' | 'conflict'

/**
 * Would saving change what the note *means*? BlockNote round-trips ordinary
 * markdown but normalises lists, rules and table padding, so a whole-document
 * round-trip comparison fires on almost every real note (noise). The constructs
 * the editor genuinely cannot express are footnotes and raw HTML, so the warning
 * keys on those instead — inside code fences they are just text and ignored.
 */
function hasUnsupportedSyntax(markdown: string): boolean {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')
  return /\[\^[^\]]+\]/.test(withoutCode) || /<\/?[a-z][^>]*>/i.test(withoutCode)
}

export function NoteEditor({
  path,
  t,
  onTitle,
}: {
  path: string
  t: Translate
  /** Push the frontmatter title to the shell so tab + breadcrumb stay in sync. */
  onTitle?: (title: string) => void
}) {
  const [doc, setDoc] = React.useState<NoteDoc | null>(null)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    let live = true
    setDoc(null)
    setError('')
    call<{ body: string; meta: { title: string; tags?: string[]; updated?: string }; etag: string }>('notes.read', { path })
      .then((read) => {
        if (live) {
          setDoc({
            path,
            body: read.body,
            title: read.meta.title ?? '',
            etag: read.etag,
            tags: Array.isArray(read.meta.tags) ? read.meta.tags : [],
            updated: read.meta.updated ?? '',
          })
        }
      })
      .catch((failure: Error) => live && setError(failure.message))
    return () => {
      live = false
    }
  }, [path])

  React.useEffect(() => {
    if (doc !== null && doc.title !== '') onTitle?.(doc.title)
  }, [doc, onTitle])

  if (error !== '') return <div className="p-4 text-xs text-muted-foreground">{error}</div>
  if (doc === null) return <div className="p-4 text-xs text-muted-foreground">{t('notes.loading')}</div>
  return <NoteBody key={doc.path} initial={doc} t={t} onTitle={onTitle} />
}

/** How the note was last touched, in words (design: "最后编辑 2 分钟前"). */
function editedAgo(iso: string, t: Translate): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return ''
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000))
  if (minutes < 1) return t('notes.edited.justNow')
  if (minutes < 60) return t('notes.edited.minutes').replace('{n}', String(minutes))
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('notes.edited.hours').replace('{n}', String(hours))
  return t('notes.edited.days').replace('{n}', String(Math.round(hours / 24)))
}

function NoteBody({ initial, t, onTitle }: { initial: NoteDoc; t: Translate; onTitle?: (title: string) => void }) {
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
      setLossy(hasUnsupportedSyntax(body))
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
        if (title.trim() !== '') onTitle?.(title.trim())
      } catch (failure) {
        if ((failure as { code?: string }).code === 'notes/conflict') {
          setStatus('conflict')
          setNoteDirty(initial.path, true)
          return
        }
        setStatus('dirty')
      }
    },
    [editor, initial.path, title, onTitle],
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

  /* The tab breadcrumb shows the same state, so it reaches the shell from here. */
  React.useEffect(() => {
    setNoteStatus(initial.path, status)
  }, [initial.path, status])

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
          <div className="wb-note-meta">
            {initial.tags.map((tag) => (
              <span key={tag} className="wb-note-tag">
                {tag}
              </span>
            ))}
            {initial.updated !== '' && <span className="wb-note-edited">{t('notes.edited')} {editedAgo(initial.updated, t)}</span>}
          </div>
          <BlockNoteView editor={editor} theme={isDark() ? 'dark' : 'light'} data-note-editor="" />
        </div>
      </div>
    </div>
  )
}
