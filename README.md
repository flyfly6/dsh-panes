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

## Develop

```bash
pnpm build      # tsdown -> lib/
pnpm typecheck  # tsc --noEmit
pnpm test       # build + node --test (host route + tab model)
pnpm check      # typecheck + test
```

Rebuild and reload the page to pick up client changes; a bundle added to a
profile needs a client restart to be composed into the boot graph.

## Known limits

- No editor/write-back, no LSP: this is a reading workspace.
- Git `push` / `pull` stay hidden by default (see the task design, D3).
- `shiki` and `@xterm/*` are not in the host's shared module table, so they must
  be bundled into `lib/client.js` (probe: 2026-11-03).
