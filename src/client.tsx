import * as React from 'react'
/**
 * dsh-panes — browser half entry.
 *
 * The file is bundled as CJS and wrapped into the client-modules factory form by
 * scripts/wrap-client.mjs, so it must export the cordis plugin (`name`, `inject`,
 * `apply`) and never call `window.__ModuleLoader__` itself.
 */
import styles from './generated/styles'
import { en, NS, zh } from './locale'
import { applyGitPanel, GitTab } from './git/tab'
import { NotesList } from './notes/NotesList'
import { ConversationSlot } from './panel/ConversationSlot'
import { createRegistry, lastPanel, rememberPanel, WorkbenchPanel, type Appearance, type TabRegistry } from './panel/WorkbenchPanel'

/**
 * The editor (BlockNote) is loaded on demand: it is by far the heaviest thing in
 * this bundle, and a note tab is the only thing that needs it. React.lazy keeps
 * the panel's boot path independent of it.
 */
const NoteEditorLazy = React.lazy(async () => {
  const module = await import('./notes/NoteEditor')
  return { default: module.NoteEditor }
})

const PLUGIN_ID = 'dsh-panes'
const PANEL_KEY = 'workbench'

export const name = PLUGIN_ID
export const inject = ['slots', 'layout', 'locale', 'workspaces', 'sessions', 'webTerminals', 'remote', 'remote.workspaceFiles'] as const

function installStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.pluginCss = PLUGIN_ID
  style.textContent = styles
  document.head.append(style)
  return () => style.remove()
}

/** Sidebar glyph for the launcher row. */
function PanelIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      aria-hidden
    >
      <rect x={1.5} y={2.5} width={13} height={11} rx={2} />
      <line x1={6} y1={2.5} x2={6} y2={13.5} />
      <line x1={6} y1={7} x2={14.5} y2={7} />
    </svg>
  )
}

/**
 * Row config values arrive as schemastery volatile refs (`{get()}`), not plain
 * values: read through the ref on every use so the settings card is live.
 */
function value(config: Record<string, unknown>, key: string): unknown {
  const raw = config[key]
  if (raw !== null && typeof raw === 'object' && typeof (raw as { get?: unknown }).get === 'function') {
    return (raw as { get: () => unknown }).get()
  }
  return raw
}

const UI_FAMILIES: Record<string, string> = {
  inter: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
}

const CODE_FAMILIES: Record<string, string> = {
  'jetbrains-mono': "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  'system-mono': 'ui-monospace, SFMono-Regular, Menlo, monospace',
}

/** A font stack is only allowed to be a font stack (no CSS beyond names). */
function fontStack(name: unknown, table: Record<string, string>): string {
  const text = String(name ?? '').trim()
  if (text === '' || text === 'follow') return ''
  return table[text] ?? (/^[\w\s,'"-.]+$/.test(text) ? text : '')
}

function size(value: unknown): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) && number >= 8 && number <= 24 ? number : 0
}

function appearanceOf(config: Record<string, unknown>): Appearance {
  return {
    uiFamily: fontStack(value(config, 'fontUiFamily'), UI_FAMILIES),
    uiSize: size(value(config, 'fontUiSize')),
    codeFamily: fontStack(value(config, 'fontCodeFamily'), CODE_FAMILIES),
    codeSize: size(value(config, 'fontCodeSize')),
    codeLineHeight: Number(value(config, 'fontCodeLineHeight') ?? 0),
  }
}

export function apply(ctx: any, config: Record<string, unknown> = {}): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-panes: locale')
  const t = ctx.locale.bind(NS)
  /**
   * Add project (R1.3): the host owns the workspace registry and its directory
   * picker. This client half exposes no `add`-shaped API today (probed: only
   * `model`/`name`/`ctx`), so the panel reports the refusal instead of a no-op.
   */
  const addProject = async (path: string): Promise<string | undefined> => {
    const service = ctx.workspaces ?? ctx.workspace
    /* v0.3: the client face does have `create({ path })` (the v0.2 note that it
       did not was wrong). Older hosts get the add/register fallback. */
    const create = (service as { create?: (input: { path: string }) => Promise<{ workspaceId?: string }> } | undefined)?.create
    if (typeof create === 'function') {
      const created = await create.call(service, { path })
      return typeof created?.workspaceId === 'string' ? created.workspaceId : undefined
    }
    const add =
      (service as { add?: (path: string) => unknown } | undefined)?.add ??
      (service as { register?: (path: string) => unknown } | undefined)?.register
    if (typeof add !== 'function') throw new Error(t('sidebar.addProjectUnavailable'))
    await add.call(service, path)
    return undefined
  }

  /** Native directory picker (host owns it; null when the user cancels). */
  const pickDirectory = async (): Promise<string | null> => {
    try {
      const service = (ctx.get?.('uiWorkspace') ?? ctx.uiWorkspace) as { pickDirectory?: () => Promise<string | null> } | undefined
      if (typeof service?.pickDirectory !== 'function') return null
      const picked = await service.pickDirectory()
      return typeof picked === 'string' && picked !== '' ? picked : null
    } catch {
      return null
    }
  }
  /**
   * New session tab: the host owns "New Session" (`uiWorkspace.connectWorkspace`
   * reuses an eligible blank or creates one and returns its id). No local state.
   */
  const newSession = async (workspaceId: string): Promise<string | undefined> => {
    let service: { connectWorkspace?: (id: string) => Promise<string> } | undefined
    try {
      service = (ctx.get?.('uiWorkspace') ?? ctx.uiWorkspace) as typeof service
    } catch {
      service = undefined
    }
    if (typeof service?.connectWorkspace !== 'function') return undefined
    try {
      const created = await service.connectWorkspace(workspaceId)
      return typeof created === 'string' && created !== '' ? created : undefined
    } catch {
      return undefined
    }
  }
  /**
   * Side chat (T3): fork the current session so the copy keeps its history.
   * Host `uiWorkspace.forkSession` is the only fork entry the Client exposes.
   */
  const forkSession = async (sessionId: string): Promise<string | undefined> => {
    let service: { forkSession?: (id: string) => Promise<string> } | undefined
    try {
      service = (ctx.get?.('uiWorkspace') ?? ctx.uiWorkspace) as typeof service
    } catch {
      service = undefined
    }
    if (typeof service?.forkSession !== 'function') return undefined
    try {
      const created = await service.forkSession(sessionId)
      return typeof created === 'string' && created !== '' ? created : undefined
    } catch {
      return undefined
    }
  }
  /**
   * Status-bar appearance toggle. The host owns the preference — `setTheme` is
   * its only write entry (`light` / `dark` / `system`) — so there is no local
   * persistence here. With `system` active we flip away from what is resolved now.
   */
  const toggleTheme = (): void => {
    let theme: { getTheme?: () => { active?: { colorScheme?: string } }; setTheme?: (id: string) => void } | undefined
    try {
      theme = (ctx.get?.('theme') ?? ctx.theme) as typeof theme
    } catch {
      theme = undefined
    }
    if (theme?.getTheme === undefined || theme.setTheme === undefined) return
    try {
      theme.setTheme(theme.getTheme().active?.colorScheme === 'dark' ? 'light' : 'dark')
    } catch {
      /* the write was refused: the label stays where it was */
    }
  }
  /**
   * R1.1: entering the workbench collapses dsh's own sidebar (otherwise the user
   * looks at two left rails), and leaving restores it. The action lives on
   * `ctx.layout.panels` (`toggleSidebar`), not on `ctx.layout` — S10 was wrong
   * about that; only the *state* is unreadable, so the current width is measured.
   */
  let collapsedByUs = false
  const narrowEnough = (): boolean => {
    const root = document.querySelector('.workbench-root')
    if (root === null) return true
    return root.getBoundingClientRect().x < 60
  }
  const collapseHostSidebar = (): void => {
    try {
      if (narrowEnough()) return
      ;(ctx.layout.panels as { toggleSidebar?: () => void } | undefined)?.toggleSidebar?.()
      collapsedByUs = true
    } catch {
      /* host without the action: the panel keeps its own back button (fallback) */
    }
  }
  const restoreHostSidebar = (): void => {
    if (!collapsedByUs) return
    collapsedByUs = false
    try {
      ;(ctx.layout.panels as { toggleSidebar?: () => void } | undefined)?.toggleSidebar?.()
    } catch {
      /* nothing to restore */
    }
  }
  const close = () => {
    rememberPanel(null)
    restoreHostSidebar()
    ctx.layout.selectPanel(null)
  }
  ctx.effect(() => installStyles(), 'dsh-panes: styles')

  // T2/T3 add their tab types through this service.
  const registry: TabRegistry = createRegistry()
  try {
    ctx.provide('workbenchTabs', registry)
  } catch {
    /* host without provide(): built-in kinds still work */
  }

  // T2: the Git tool window. The host half owns /dsh-ide-git/api/*; this only
  // mounts its styles/dictionaries and registers the tab type.
  ctx.effect(() => {
    applyGitPanel(ctx)
    return registry.register({
      kind: 'git',
      order: 30,
      render: ({ project, sessionId }) => (
        <GitTab ctx={ctx} cwd={project?.path ?? ''} sessionId={sessionId} />
      ),
    })
  }, 'dsh-panes: git tab')

  // T3: the vault lives outside every workspace, but each project has its own
  // folder inside it (v0.3), so the list is scoped by the tab's project.
  ctx.effect(() => {
    const offList = registry.register({
      kind: 'notes',
      order: 50,
      render: ({ open, t, project, projects }) => (
        <NotesList
          t={t}
          projectPath={project?.path ?? ''}
          projects={[{ path: '', title: t('notes.inbox') }, ...projects]}
          open={(path, title) => open({ kind: 'note', contentId: path, title })}
        />
      ),
    })
    const offNote = registry.register({
      kind: 'note',
      order: 51,
      render: ({ tab, t, retitle }) => (
        <React.Suspense fallback={<div className="p-4 text-xs text-muted-foreground">{t('notes.loading')}</div>}>
          <NoteEditorLazy path={tab.contentId} t={t} onTitle={retitle} />
        </React.Suspense>
      ),
    })
    return () => {
      offNote()
      offList()
    }
  }, 'dsh-panes: notes tabs')

  const apps = () => {
    try {
      return (ctx.slots.entries('main') ?? [])
        .filter((entry: any) => typeof entry?.options?.key === 'string' && entry.options.key !== PANEL_KEY)
        .map((entry: any) => {
          const key = String(entry.options.key)
          /* The host's own label wins: the sidebar must say what the default
             UI says. Locale knowledge is only the fallback. */
          const own = typeof entry.options.label === 'string' ? entry.options.label.trim() : ''
          const known = `apps.${key}` in zh || `apps.${key}` in en
          return { key, label: own !== '' ? own : known ? t(`apps.${key}`) : key.charAt(0).toUpperCase() + key.slice(1) }
        })
    } catch {
      return []
    }
  }

  ctx.effect(
    () =>
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_KEY,
            locale: NS,
            children: { 'workbench.conversation': { kind: 'single', scope: 'session' } },
            inject: () => ({
              t,
              close,
              remote: ctx.remote,
              retainSession: (sessionId: string) => ctx.sessions.retain(sessionId, { source: 'workbench' }),
              terminal: (sessionId: string, key: string, contentId: string) => ctx.webTerminals.view(sessionId, key, contentId),
              apps: apps(),
              openPanel: (key: string) => ctx.layout.selectPanel(key),
              registry,
              /* Read per render: the settings card writes the same volatile refs. */
              appearance: () => appearanceOf(config),
              addProject,
              pickDirectory,
              toggleTheme,
              newSession,
              forkSession,
              collapseHostSidebar,
              restoreHostSidebar,
            }),
          },
          WorkbenchPanel,
        ),
      ),
    'dsh-panes: workbench panel',
  )

  // Embedded Session tab body: the host conversation factory inside the slot's provider.
  ctx.effect(
    () => ctx.slots.inject('workbench.conversation', () => ctx.slots.register({ name: 'workbench.conversation' }, ConversationSlot)),
    'dsh-panes: session conversation',
  )

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_KEY, order: 40, label: () => t('panel.title') }, PanelIcon),
      ),
    'dsh-panes: sidebar launcher',
  )

  /* D10 / R11: `workspace` always lands here, `last` only when this panel was
     the last one used, `conversation` leaves dsh's own view untouched. */
  const startup = String(value(config, 'startup') ?? 'workspace')
  const wanted = startup === 'conversation' ? false : startup === 'last' ? lastPanel() === PANEL_KEY : true
  if (wanted) {
    const timer = setTimeout(() => {
      try {
        ctx.layout.selectPanel(PANEL_KEY)
        rememberPanel(PANEL_KEY)
      } catch {
        /* layout not ready: the sidebar row still works */
      }
    }, 300)
    ctx.effect(() => () => clearTimeout(timer), 'dsh-panes: startup panel')
  }
}
