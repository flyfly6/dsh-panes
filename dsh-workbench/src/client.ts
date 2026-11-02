/**
 * dsh-workbench — browser half.
 *
 * Registers the Workspace `main` panel (D1). The host renders every `main` panel
 * as a left-sidebar row on its own, so registering the panel is the whole entry.
 *
 * Bundle shape is the client-modules contract: the factory registers once at
 * boot, its body runs lazily on first use, and the returned object is the
 * cordis plugin (`apply` + `inject`).
 */
const PLUGIN_ID = 'dsh-workbench'
const API = '/dsh-workbench/api'
const NS = 'workbench'
const PANEL_KEY = 'workbench'

type Dict = Record<string, string>

const zh: Dict = {
  'panel.title': '工作台',
  'panel.back': '返回会话',
  'panel.host': '宿主连接',
  'panel.host.ok': '正常',
  'panel.host.failed': '不可用',
  'panel.empty': '项目侧栏与 tab 工作区将在 T1 落地。',
}

const en: Dict = {
  'panel.title': 'Workspace',
  'panel.back': 'Back to conversation',
  'panel.host': 'Host bridge',
  'panel.host.ok': 'connected',
  'panel.host.failed': 'unavailable',
  'panel.empty': 'Project sidebar and tab workspace land in T1.',
}

/** Design §2.0d-1: shadcn-style aliases mapped onto host theme tokens. */
const STYLE = `
.workbench-root {
  --background: var(--dsw-alias-bg-base);
  --foreground: var(--dsw-alias-text-primary);
  --card: var(--dsw-alias-bg-layer-2);
  --muted-foreground: var(--dsw-alias-text-secondary);
  --border: var(--dsw-alias-border-l2);
  --primary: var(--dsw-alias-brand-primary);
  --radius: 6px;
  display: flex; flex-direction: column; height: 100%; width: 100%;
  background: var(--background); color: var(--foreground);
  font-size: 13px;
  padding-top: var(--dsh-frame-top-clearance, 0px);
}
.workbench-root * { box-sizing: border-box; }
`

let disposed = false

function installStyle(): () => void {
  const style = document.createElement('style')
  style.dataset.pluginCss = PLUGIN_ID
  style.textContent = STYLE
  document.head.append(style)
  return () => style.remove()
}

async function call(op: string, args: Record<string, unknown> = {}): Promise<any> {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dsh-plugin': PLUGIN_ID },
    body: JSON.stringify({ op, args }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ok !== true) throw new Error(body?.message ?? `HTTP ${response.status}`)
  return body.data
}

function factory(require: (id: string) => any) {
  const React = require('react')
  const h = React.createElement

  // S2/S5 probe: which host modules a client bundle can actually require.
  // ponytail: temporary diagnostic; drop once the T1 toolchain is settled.
  const PROBES = ['react', '@deepseek-ai/dsh-client-ui-primitives', 'shiki', '@xterm/xterm']
  const available = PROBES.map((id) => {
    try {
      require(id)
      return `${id}=yes`
    } catch {
      return `${id}=no`
    }
  }).join(' · ')

  type Props = { t: (key: string) => string; close: () => void }

  function WorkspacePanel({ t, close }: Props) {
    const [host, setHost] = React.useState('pending' as 'pending' | 'ok' | 'failed')
    React.useEffect(() => {
      let live = true
      call('ping')
        .then(() => live && setHost('ok'))
        .catch(() => live && setHost('failed'))
      return () => {
        live = false
      }
    }, [])
    return h(
      'div',
      { className: 'workbench-root' },
      h(
        'header',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            height: 36,
            padding: '0 12px',
            borderBottom: '1px solid var(--border)',
          },
        },
        h('strong', { style: { fontWeight: 600 } }, t('panel.title')),
        h(
          'span',
          { style: { color: 'var(--muted-foreground)', fontSize: 11 } },
          `${t('panel.host')}: ${t(host === 'ok' ? 'panel.host.ok' : host === 'failed' ? 'panel.host.failed' : 'panel.host')}`,
        ),
        h('span', { style: { flex: 1 } }),
        h(
          'button',
          {
            type: 'button',
            onClick: close,
            style: {
              all: 'unset',
              cursor: 'pointer',
              padding: '2px 8px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              color: 'var(--foreground)',
              fontSize: 12,
            },
          },
          t('panel.back'),
        ),
      ),
      h(
        'div',
        { style: { flex: 1, display: 'grid', placeItems: 'center', color: 'var(--muted-foreground)' } },
        t('panel.empty'),
      ),
      h(
        'footer',
        {
          style: {
            borderTop: '1px solid var(--border)',
            padding: '4px 12px',
            fontSize: 10,
            color: 'var(--muted-foreground)',
            fontFamily: 'ui-monospace, monospace',
          },
        },
        available,
      ),
    )
  }

  /** Sidebar glyph. The sidebar owns the row and hands the icon its box size. */
  function PanelIcon({ size }: { size: number }) {
    return h(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        'aria-hidden': true,
      },
      h('rect', { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2 }),
      h('line', { x1: 6, y1: 2.5, x2: 6, y2: 13.5 }),
      h('line', { x1: 6, y1: 7, x2: 14.5, y2: 7 }),
    )
  }

  const inject = ['slots', 'layout', 'locale'] as const

  function apply(ctx: any) {
    if (disposed) return
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-workbench: locale')
    const t = ctx.locale.bind(NS)
    const close = () => ctx.layout.selectPanel(null)
    ctx.effect(() => installStyle(), 'dsh-workbench: styles')
    // The panel body and its sidebar launcher are two registrations: `main` holds
    // the content, `sidebar.panellist` holds the row and resolves its label.
    ctx.effect(
      () => ctx.slots.inject('main', () => ctx.slots.register(
        { name: 'main', key: PANEL_KEY, locale: NS, inject: () => ({ t, close }) },
        WorkspacePanel,
      )),
      'dsh-workbench: workspace panel',
    )
    ctx.effect(
      () => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
        { name: 'sidebar.panellist', id: PANEL_KEY, order: 40, label: () => t('panel.title') },
        PanelIcon,
      )),
      'dsh-workbench: sidebar launcher',
    )
  }

  return { name: PLUGIN_ID, inject, apply }
}

const loader = (window as any).__ModuleLoader__ as
  | { load(entry: { id: string; factory: (require: (id: string) => any) => any }): void }
  | undefined
loader?.load({ id: PLUGIN_ID, factory })
