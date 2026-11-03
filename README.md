# dsh-workbench

Tabbed workspace workbench for DeepSeek Harness: one full-screen `main` panel
with a project sidebar and per-project tabs (code view, search, Markdown
preview, terminal, browser, session, Git, notes).

**Status: T1 done, T2 done, T3 done, review pass done.** The panel shell, project
sidebar, per-project tabs, file/explorer/search views, Markdown preview,
terminal, browser, embedded session, the **Git tool window** and the
**Notion-style notes vault** exist. A review pass added the design-faithful
chrome (two-line project rows, NEW TAB menu, split search, breadcrumb meta,
status bar), file paging, font settings, and the host-side sidebar collapse.

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
| `src/panel/` | Panel shell, file/explorer/search/Markdown/terminal/browser views, shared types. |
| `src/git/` | Git tool window, forked from `dsh-ide-git` v0.21.1 (MIT): `host.js` (routes + guards), `panel.js` (UI), `tab.tsx`/`status.ts` (adapter), `UPSTREAM.md`. |
| `src/notes.ts` | Notes vault (host): `notes.*` ops, path fence, atomic writes with etags, frontmatter preservation, `.trash`. |
| `src/notes/` | Notes UI: the list tab and the BlockNote editor (lazy-loaded). |
| `src/config.ts` | Row config schema (startup, Git rail switches, AI commit message, `experimentalRemoteOps`, `notesVaultPath`). |
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

## Settings (Plugins → dsh-workbench)

| Field | Meaning |
|---|---|
| `startup` | `workspace` (default) · `last` (only if it was the last panel) · `conversation` |
| `fontUiFamily` / `fontUiSize` | UI font stack / size (px); empty = follow dsh |
| `fontCodeFamily` / `fontCodeSize` / `fontCodeLineHeight` | code font stack, size, line height |
| `notesVaultPath` | absolute notes directory; empty = `$DSH_HOME/notes` |
| `experimentalRemoteOps` | shows and allows push / pull (default off) |
| `rail*` | one switch per Git action-rail button |

## Known limits

- No editor/write-back, no LSP: this is a reading workspace.
- Git `push` / `pull` stay hidden by default (D3): the buttons are absent until
  `experimentalRemoteOps` is on in the plugin settings, and the host refuses those
  methods (`disabled-by-config`) while it is off.
- The Git panel is a fork: before touching `src/git/panel.js` read
  `src/git/UPSTREAM.md` — our edits are `[workbench-fork]`-marked hunks that a
  re-sync has to re-apply.
- The Git status bar/badge call `summary` with `stats: false` (no `--numstat`
  passes); it shows `±n` changed files, not added/removed line counts.
- Notes live outside every workspace: `$DSH_HOME/notes` by default, or any
  absolute directory in the plugin settings (an Obsidian vault works). One note is
  one `.md`; the host owns the frontmatter, the editor only edits the body.
- The bundle is **2.2 MB gzip**, most of it BlockNote (editor + yjs). The editor
  is loaded lazily inside the bundle — that keeps a failure in it from taking the
  panel's boot down, not the download.
- `shiki` and `@xterm/*` are not in the host's shared module table, so they must
  be bundled into `lib/client.js` (probe: 2026-11-03).
- Search uses the machine's `rg` first, then the `rg` bundled via `@vscode/ripgrep`,
  then a bounded JS walk. The response says which engine ran (`engine`).
- **`Add project` cannot register a workspace.** The client half exposes
  `workspaces.model` / `name` but no `add`, and `ctx.layout.panels` has no
  directory picker; the row and the `+` menu entry report that refusal instead
  of pretending. The row stays because the host may add the API.
- **Search and the notes vault act on client-supplied absolute paths.** Both are
  fenced by the plugin header + same-origin check, not by "must be inside a
  registered workspace" (the host exposes no workspace list to the host half).
  Treat the route as trusted-page-only, the way `/api` is.
- **Fonts** (`fontUiFamily` / `fontUiSize` / `fontCodeFamily` / `fontCodeSize` /
  `fontCodeLineHeight`) live in the plugin settings card; see §Appearance. Empty
  means "follow dsh". A custom value is a font stack, validated to font names.
- The panel collapses dsh's own sidebar while it is on screen
  (`ctx.layout.panels.toggleSidebar`) and restores it on leave; the panel's own
  sidebar auto-collapses to the 52px rail below 820px of panel width.
- Notes: a symlink inside the vault is refused (`lstat`), so a note can never be
  a link to a file outside the vault — read *or* write.
- The browser half is a single 7.8 MB file (2.2 MB gzip), so `React.lazy` buys
  no download time; it only keeps a broken editor from taking the panel's boot
  down.
