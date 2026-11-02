# dsh-workbench

Tabbed workspace workbench for DeepSeek Harness: one full-screen `main` panel
with a project sidebar and per-project tabs (code view, search, Markdown
preview, terminal, browser, session, Git, notes).

**Status: T1 in progress.** The panel shell, project sidebar, per-project tabs,
file view and explorer exist; highlighting, search, terminal/browser/session tabs
land next, then the Git client (T2) and notes (T3).

The repository root *is* the package: `package.json`, `src/`, `test/` and
`cordis.patch.yml` sit here beside `designs/` and `.trellis/`.

## Install (local directory, v1 path)

```bash
# 1. build (from the repository root)
pnpm install && pnpm build

# 2. install into a profile as a linked dependency
dsh plugin --profile desktop add "$(pwd)"

# 3. register the bundle so the loader mounts it
#    add "dsh-workbench" to dsh.profile.bundles in
#    ~/.dsh/profiles/desktop/package.json, then restart the client.
```

Uninstall: remove it from `dsh.profile.bundles` and run
`dsh plugin --profile desktop remove dsh-workbench`.

## Shape

| Path | Role |
|---|---|
| `src/index.ts` | Host half: cordis plugin, `POST /dsh-workbench/api` route. |
| `src/ui/` | shadcn primitives (button, input, dropdown-menu) + `cn()`. |
| `src/panel/` | Panel shell, file view, explorer view, shared types. |
| `src/styles/tailwind.css` | Design tokens (host theme vars) + Tailwind layers. |
| `src/client.ts` | Browser half: registers the `main` panel + its `sidebar.panellist` launcher row; panel shell, tabs, file/explorer views. |
| `src/tabs.ts` | Pure tab model: per-project tab sets, idempotent open, persisted layout. |
| `cordis.patch.yml` | Bundle patch: one `insert` row naming this package. |
| `lib/` | Build output (gitignored). |

Two registrations are needed for one panel: `main` holds the content, and
`sidebar.panellist` (same `id` as the panel key) holds the sidebar row, its
label thunk and its icon. Registering `main` alone shows nothing.

Host calls go through one same-origin route with `{ op, args }`; the client must
send `x-dsh-plugin: dsh-workbench`, and the host answers only loopback or
same-origin callers.

## Toolchain

Tailwind 3 + shadcn/ui (Radix primitives, `class-variance-authority`, `lucide-react`),
all bundled into `lib/client.js` — only `react`, `react-dom` and `@deepseek-ai/*`
stay external (host shared module table). Tailwind runs with **preflight off** and
every component lives under `.workbench-root` / `.workbench-portal`.

The browser half is compiled to **CJS** and wrapped into the client-modules factory
form by `scripts/wrap-client.mjs`; it must not emit ESM imports, because the loader
gives the bundle a `require`, never a module graph.

```bash
pnpm build      # build:styles (Tailwind -> src/generated/styles.ts) + tsdown + wrap
pnpm typecheck  # tsc --noEmit
pnpm test       # node --test (host route + tab model)
pnpm check      # build + typecheck + test
```

Rebuild and reload the page to pick up client changes; a bundle added to a
profile needs a client restart to be composed into the boot graph.

## Known limits

- No editor/write-back, no LSP: this is a reading workspace.
- Git `push` / `pull` stay hidden by default (see the task design, D3).
- `shiki` and `@xterm/*` are not in the host's shared module table, so they must
  be bundled into `lib/client.js` (probe: 2026-11-03).
