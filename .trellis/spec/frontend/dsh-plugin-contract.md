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
| Plugin warns `@deepseek-ai/schemastery is not resolvable` | The profile has no `@deepseek-ai/schemastery`; a **symlinked dev package** resolves from its real path, not the profile. `dsh plugin --profile <p> add @deepseek-ai/schemastery`. |

## Vendoring an upstream plugin's client bundle (fork recipe)

Upstream plugins ship `src/client.js` already wrapped as
`window.__ModuleLoader__.load({ id, factory: (require) => { … } })`. To fold one
into our own bundle (done for `dsh-ide-git` → `src/git/panel.js`, see
`src/git/UPSTREAM.md`):

1. **Rewrite the wrapper into a factory we call**: replace the head with
   `export default function createX(require) {` and the tail with
   `return { apply, …components }; }`. `require` arrives as a *parameter*, so the
   bundle's own `require` (the wrapper's) is what inner code calls — verified in
   the built output: the call site stays `createX(require)` and the externals stay
   `require("react")`.
2. **Call it lazily, once**: `let loaded = null; function mod() { return loaded ??= createX(require) }`.
   One instance per page keeps upstream's module-level caches (repo list, first-paint).
3. **Delete upstream's seat registrations**, keep its `apply` for styles, locale
   dictionaries, settings card and service bindings. A plugin that registers a
   sidebar tab always has 2–4 registration doors; removing them is the whole
   adapter and leaves the UI untouched.
4. **Rename the config namespaces, not the API route**: row config namespace =
   *our* loader row id (`workbench`), settings-card key = *our* package name
   (`dsh-panes`), locale namespace = a fresh one. The HTTP prefix can stay
   upstream's (`/dsh-ide-git/api`) — it is not user-visible.
5. **Add `*.d.ts` siblings** for the vendored `.js` (`allowJs` is off, so tsc
   ignores the file and reads your hand-written surface).
6. **Never edit an internal upstream function without a `// [workbench-fork]`
   marker** and an entry in `UPSTREAM.md`; that file lists the exact hunks a
   re-sync has to re-apply.

## Row config (`Config` export) — what the settings card needs

- The host serves a plugin's row config to the browser through `ctx.configForms`;
  the namespace is the **loader row id** from `cordis.patch.yml`, and the Plugins
  page renders `plugins.bundle.config` keyed by **package name**.
- The schema comes from the host half's exported `Config` (schemastery). A plugin
  that is mounted *inside* another plugin (`ctx.plugin(upstream, config)`) cannot
  export it — build the schema in our own `src/config.ts` instead.
- Every field the card writes must be declared **and** `.volatile()`, or the Host
  refuses the write ("Config field … is not volatile") and the switch silently
  rolls back. Verified live: declaring `experimentalRemoteOps` and toggling it
  from the card updates the row config and re-renders the panel without a reload.

## Shipping a rich-text editor in a single-file bundle (BlockNote, verified 2026-11-03)

The browser half is one CJS file with no module graph, and that collides with
modern editor packages in four specific ways. All four bit us; all four are now
handled, two in `tsdown.config.ts` and two in `scripts/wrap-client.mjs`.

| Symptom | Cause | Fix |
|---|---|---|
| `require("node:crypto") missed the module table` | a dependency (yjs → lib0) resolved its **node** export condition | the wrapper's `require` shims `node:crypto`/`crypto` to `{ webcrypto: globalThis.crypto }` |
| `process is not defined` | libraries read `process.env.NODE_ENV` | the wrapper declares a local `var process` inside the factory (never a global: `globalThis.process` makes *other* plugins take their node branch and crash) |
| `Cannot read properties of undefined (reading 'S')` on first render | **`react-dom/client` was bundled a second time**; its internals (`ReactSharedInternals.S`, React 19 name) ran against the host's React 18 | externalize `react-dom/*` and `react/jsx-runtime` **as a family** |
| `import.meta` / split chunks / duplicated React | code splitting or a second React copy | `outputOptions.inlineDynamicImports: true` + external `react`/`react-dom*` |

Two more rules that come from this:

- **CSS**: Mantine/BlockNote ship `@import` chains; the bundle can only carry
  text, so `scripts/build-styles.mjs` inlines `@import url(...)` recursively
  (`createRequire` + a seen-set) and appends the result to the injected stylesheet.
- **Evaluate the heavy module lazily**: `React.lazy(() => import('./notes/NoteEditor'))`.
  The download is still at boot (one file), but a module-eval failure then costs
  one tab instead of the whole panel — and it turns an opaque boot error into a
  catchable stack you can read off `window.__panesLastError`.

## Row config values are volatile refs, not values

`apply(ctx, config)` receives objects with a `get()` for every field declared with
`.volatile()` — `JSON.stringify(config)` prints `{}` for all of them, and reading
`config.field` gives you an object, not the value. Two consequences:

- host code that reads config per request must dereference (`value.get()`), e.g.
  `plainConfig(config)` / `configValue(value)`;
- reading it once at `apply` time freezes the value — the settings page's writes
  then do nothing until a reload.

## Notes vault conventions (T3)

- `.md` is the only truth: the editor converts blocks on save, the host owns the
  frontmatter (unknown fields and their order survive; only `title`/`created`/
  `updated` are written).
- Every write is conditional on the `etag` read with the note (`mtimeMs:size`);
  a mismatch is `notes/conflict` (409), never a silent overwrite.
- Paths are vault-relative; `..`, absolute paths and `.trash` are refused before
  any fs call, and reads verify the resolved path stays inside the vault.
- Delete moves the note to `<vault>/.trash/<ISO>-<name>.md`.
- BlockNote cannot represent footnotes or raw HTML: compare the markdown
  round-trip (whitespace-insensitive) and **warn**; do not silently normalise and
  do not lock the note into a read-only mode either (a preview that renders a
  stale body is worse than a warning).
