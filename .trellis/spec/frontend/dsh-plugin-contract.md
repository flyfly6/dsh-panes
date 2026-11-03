# DSH Plugin Contract (verified 2026-11-03)

> Facts here were read from the shipped client bundles and confirmed live in a
> scratch profile (`workbench-spike`, dsh `0.2.1-rc.5`). Do not re-derive them from
> guesswork; re-verify only when the host release changes.

## Two halves, one package

| Half | File | Declared by |
|---|---|---|
| Host (cordis plugin, Node) | `lib/index.js` | `main` |
| Browser (module-loader factory) | `lib/client.js` | `exports['./client']` + `dsh.client` |

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-locale"] }
}
```

`exports['./package.json']` is required too, or the client half never enters the
boot graph.

## A full-screen panel is TWO registrations

`main` alone renders nothing — no sidebar row, no way in. The sidebar owns the
row and takes it from the `sidebar.panellist` list slot, matched by `id`.

```ts
ctx.slots.inject('main', () => ctx.slots.register(
  { name: 'main', key: 'my-panel', locale: NS, inject: () => ({ t, close }) },
  Panel,
))

ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
  { name: 'sidebar.panellist', id: 'my-panel', order: 40, label: () => t('panel.title') },
  Icon, // receives { size: number, active: boolean }
))
```

- `label` is a thunk so it follows the active locale.
- `inject: () => props` is how the owner passes props to the panel component.
- `ctx.layout.selectPanel(key)` enters; `ctx.layout.selectPanel(null)` returns to
  the conversation.

## The browser bundle has no module graph

The loader hands the bundle `factory(require)` — there is no ESM resolution inside
it. A source file that says `import * as React from 'react'` must end up as
`require('react')`, which means:

- build the browser half as **CJS**, then wrap it once into
  `window.__ModuleLoader__.load({ id, factory: (require) => { … return module.exports } })`;
- keep only the shared-table packages external (`react`, `react-dom`,
  `react/jsx-runtime`, `@deepseek-ai/*`); bundle everything else (Radix, lucide,
  shiki, clsx…);
- never call `window.__ModuleLoader__` from the source itself — the wrapper owns it.

Two builds, one package: host half ESM for Node, browser half CJS + wrapper.

## Shared module table

Client bundles resolve `require` against the host's frozen table. Confirmed
available: `react`, `react/jsx-runtime`, `react-dom`,
`@deepseek-ai/dsh-client-ui-primitives`. Confirmed **missing**: `shiki`,
`@xterm/xterm` — bundle anything like that into `lib/client.js` itself.

## Host HTTP route

```ts
export const name = 'my-panel'
export const inject = ['webServer']
export function apply(ctx: any) {
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/my-panel/api', handler }), 'label')
}
```

- One route, `POST { op, args }` → `{ ok: true, data } | { ok: false, code, message }`.
- Trust fence: accept only a loopback `Host` (or `sec-fetch-site: same-origin|same-site`),
  plus the plugin header `x-dsh-plugin: <package name>`.
- `ctx.effect` owns the route lifetime, so disabling the plugin removes it.

## Embedding another surface: the conversation recipe

The open-source repo (`packages/client/ui-subagent/src/client/sidebar-chat`) shows the
supported pattern; verified live 2026-11-03.

1. When a panel registers a **session-scoped child slot**, the framework injects
   `SessionProvider` + `renderSlot` into that panel:

   ```ts
   ctx.slots.register({
     name: 'main', key: 'my-panel',
     children: { 'my-panel.conversation': { kind: 'single', scope: 'session' } },
   }, Panel)
   ```

2. `SessionProvider` wants a **`SessionReference`, not an id** — get it from
   `ctx.sessions.retain(sessionId, { source: 'my-plugin' })` and release it on unmount.
   Passing a string throws `Cannot read properties of undefined (reading 'session')`.

3. Render `<SessionProvider session={reference}>{renderSlot('my-panel.conversation', {})}</SessionProvider>`
   and have that child slot component call the host factory:

   ```ts
   renderFactorySlot('conversation.content',
     { variant: 'embedded', phase, hero },
     { slots: { views: ChatViews } })   // ChatViews → props.renderSlot('conversation.session', { view: 'chat' })
   ```

Zero-prop tricks that do **not** work: `renderFactorySlot('main', 'conversation')`
(a keyed slot does not dispatch across panels), portalling the conversation DOM (the
host unmounts it while another main panel is selected), and deep-linking an iframe
(there is no session route). Wrap experimental host surfaces in an error boundary —
a throw inside a slot kills the whole panel.

## Terminal tabs

`ctx.webTerminals` (service name `webTerminals`, from `dsh-api-terminal-controller`)
owns the model: `view(sessionId, key, contentId)` → `{ state, mount(), write(), resize(),
acknowledge(revision), close() }`. Never spawn a PTY yourself.

Frames follow the wire contract: `snapshot` (full screen — `term.reset()` first),
`output` (append), `state`/`ack` (no paint). Acknowledge every painted revision, or the
host stops sending. `mount()` returns a detach callback that leaves the process alive;
`close()` ends it, so map it to closing the tab, not to switching tabs. xterm needs its
stylesheet, and plugins ship CSS as text: fold `@xterm/xterm/css/xterm.css` into the
generated styles module.

## Install loop

```bash
dsh plugin --profile <p> add /abs/path/to/package   # pnpm link
# then add the package name to dsh.profile.bundles in ~/.dsh/profiles/<p>/package.json
```

Rebuild + page reload picks up client changes for an already-composed bundle; a
**new** bundle needs a client restart.

## Tells you got it wrong

| Symptom | Cause |
|---|---|
| No sidebar row, no console error | Forgot the `sidebar.panellist` registration. |
| `404` on `/plugins/<pkg>/client.js` | Expected: served through combo URLs; only the boot graph path works. |
| Client half silently absent | `exports['./package.json']` or `dsh.client` missing. |
| `import failed: cannot resolve ...` on boot | The client bundle emitted an ESM import (or a relative chunk) instead of a factory body. |
| Radix popper renders unstyled/wrong colors | Tokens live on `.workbench-root`; the portal needs them too (`.workbench-portal`). |
