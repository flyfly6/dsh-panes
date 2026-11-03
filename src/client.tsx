/**
 * dsh-workbench — browser half entry.
 *
 * The file is bundled as CJS and wrapped into the client-modules factory form by
 * scripts/wrap-client.mjs, so it must export the cordis plugin (`name`, `inject`,
 * `apply`) and never call `window.__ModuleLoader__` itself.
 */
import styles from './generated/styles'
import { en, NS, zh } from './locale'
import { ConversationSlot } from './panel/ConversationSlot'
import { createRegistry, WorkbenchPanel, type TabRegistry } from './panel/WorkbenchPanel'

const PLUGIN_ID = 'dsh-workbench'
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

export function apply(ctx: any, config: { startup?: string } = {}): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-workbench: locale')
  const t = ctx.locale.bind(NS)
  const close = () => ctx.layout.selectPanel(null)
  ctx.effect(() => installStyles(), 'dsh-workbench: styles')

  // T2/T3 add their tab types through this service.
  const registry: TabRegistry = createRegistry()
  try {
    ctx.provide('workbenchTabs', registry)
  } catch {
    /* host without provide(): built-in kinds still work */
  }

  const apps = () => {
    try {
      return (ctx.slots.entries('main') ?? [])
        .filter((entry: any) => typeof entry?.options?.key === 'string' && entry.options.key !== PANEL_KEY)
        .map((entry: any) => ({ key: String(entry.options.key), label: String(entry.options.label ?? entry.options.key) }))
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
            }),
          },
          WorkbenchPanel,
        ),
      ),
    'dsh-workbench: workbench panel',
  )

  // Embedded Session tab body: the host conversation factory inside the slot's provider.
  ctx.effect(
    () => ctx.slots.inject('workbench.conversation', () => ctx.slots.register({ name: 'workbench.conversation' }, ConversationSlot)),
    'dsh-workbench: session conversation',
  )

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_KEY, order: 40, label: () => t('panel.title') }, PanelIcon),
      ),
    'dsh-workbench: sidebar launcher',
  )

  // D10: land on the workbench at startup unless the user asked for the conversation.
  // `toggleSidebar` is not on the client layout service, so the dsh sidebar stays as is
  // (S10 fallback: no programmatic collapse, the panel keeps its own 返回会话 button).
  if ((config.startup ?? 'workspace') !== 'conversation') {
    const timer = setTimeout(() => {
      try {
        ctx.layout.selectPanel(PANEL_KEY)
      } catch {
        /* layout not ready: the sidebar row still works */
      }
    }, 300)
    ctx.effect(() => () => clearTimeout(timer), 'dsh-workbench: startup panel')
  }
}
