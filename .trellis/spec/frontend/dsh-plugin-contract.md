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
