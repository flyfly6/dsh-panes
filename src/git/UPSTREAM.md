# Upstream: dsh-ide-git

We forked **[KannaKuron/dsh-ide-git](https://github.com/KannaKuron/dsh-ide-git)** v0.21.1
(MIT — see `LICENSE`, which is upstream's file, unmodified) into `src/git/`.

| file | upstream | what it is |
| --- | --- | --- |
| `src/git/host.js` | `src/index.js` | host half: `/dsh-ide-git/api/<method>`, ~48 git methods, argv-only `spawn`, per-repo write queue |
| `src/git/panel.js` | `src/client.js` | browser half: the whole Git tool window (branch tree, commit graph, diff, changes, commit box, action rail) |
| `src/git/LICENSE` | `LICENSE` | upstream MIT text |

Sync baseline: tag `v0.21.1`, upstream files copied verbatim, then the edits below.
Everything we changed is marked `[workbench-fork]` in place and is listed here.

## Host half (`src/git/host.js`)

1. **Row config moved out.** Upstream exports a schemastery `Config` for its own
   loader row. We mount it *inside* `dsh-workbench` (`ctx.plugin(gitHost, config)`
   in `src/index.ts`), so it cannot own a row: the schema lives in
   `src/config.ts`, generated from `RAIL_CONFIG_IDS` (exported here).
2. **`apply(ctx, config)`** stores the row config (`configure()`) so the route can
   read it per request, and drops nothing else: prefix route, trust fence,
   `WRITE_METHODS` serialization, `confirm: true` destructives are upstream's.
3. **`assertRemoteOpsAllowed`** (R2.10): `push`, `pull`, `pushTags`,
   `branchDeleteRemote`, `tagDeleteRemote`, `remoteAdd`, `remoteRemove` and
   `commit{push:true}` answer `disabled-by-config` (403) until
   `experimentalRemoteOps` is on. Implementations stay, only the door is shut.
4. **Unborn branch** (R2.2): a freshly `git init`-ed workspace has no `HEAD`.
   `currentBranchOf` falls back to `symbolic-ref --short HEAD`, and `log` maps
   "does not have any commits yet" to an empty history instead of an error.

## Browser half (`src/git/panel.js`)

1. **Self-registration removed.** Upstream wrapped its body in
   `window.__ModuleLoader__.load({ id, factory })`. It is now
   `export default function createGitPanel(require)` — the workbench client half
   calls it once and gets `{ apply, Panel, LocaleLive, translate }` back.
   `require` is the host's shared module table, handed in by
   `scripts/wrap-client.mjs`'s factory.
2. **Three seats deleted** (there is only one now — our `git` tab):
   the `dsh-better-sidebar` tab, the native right-sidebar seats
   (`sidebarRightTabs` + preview tab), the `conversation.view` tab, and the
   composer status pill (`conversation.input.left`). Their components remain as
   dead code (the smallest safe diff); the prewarm, `modelDirectories`,
   `configForms` and settings-card wiring stay.
3. **Namespaces:** `RAIL_NS` `ide-git` → `workbench` (our row id),
   `SETTINGS_BUNDLE` `dsh-ide-git` → `dsh-workbench` (our package name, the key
   the Plugins page uses), `LOCALE_NS` → `dsh-workbench.git` (the workbench panel
   owns `dsh-workbench`). `API_BASE` stays `dsh-ide-git/api` — the route prefix is
   upstream's.
4. **Placement settings deleted:** the `conversationTab` / `immersive` /
   `composerStatus` switches configured seats that no longer exist, and their
   fields are not in our schema (a write would be refused by the Host).
5. **New section: 远程操作** — the one switch for `experimentalRemoteOps`
   (R2.10), plus `remoteOpsEnabled()` gating three surfaces: the rail
   (`pull` / `push`), every context menu via `openMenuAt` → `withoutRemoteActions`,
   and the commit box's “commit and push”.
6. Rail settings list hides the two remote entries while the switch is off.

## Adapter seam (ours, not upstream)

- `src/git/tab.tsx` — instantiates the module, mounts `apply`, renders the panel
  with `scope: { cwd, sessionId }` and `visible: true`.
- `src/git/status.ts` — the status-bar/badge summary (`summary` with
  `stats: false`), 15 s TTL, shared per project path.
- `src/git/panel.d.ts` / `src/git/host.d.ts` — hand-written types for the two
  vendored files; typecheck never sees upstream's JS.

## Syncing a new upstream version

```bash
git clone --depth 1 --branch <tag> https://github.com/KannaKuron/dsh-ide-git /tmp/dsh-ide-git
# 1. re-copy both halves, then 2. re-apply the edits above
cp /tmp/dsh-ide-git/src/index.js src/git/host.js
cp /tmp/dsh-ide-git/src/client.js src/git/panel.js
cp /tmp/dsh-ide-git/LICENSE src/git/LICENSE
diff -u /tmp/dsh-ide-git/src/index.js src/git/host.js | head -100   # expect only §Host entries
```

The wrapper rename and the seat deletions are mechanical; the host edits are
four hunks. Re-run, in order:

1. `node --check src/git/panel.js` — the file has to stay parseable JS.
2. `grep -c '\[workbench-fork\]' src/git/*.js` — every edit still marked.
3. `pnpm check` — build (the panel must still bundle), typecheck, tests
   (`test/git.test.mjs` covers the trust fence, the config gate, summary and the
   empty-repository paths).
4. In the GUI: open the `git` tab on a repo with changes, stage → unstage,
   double-click a file for the diff, and toggle 插件 → dsh-workbench → 远程操作.

## Known upstream behaviour we did not change

- Repo discovery scans the workspace for repositories, so a workspace that is a
  *parent* of repositories shows a picker (`repo.pick`) rather than an error.
- `patch` is capped at 400 KB and `git` output at 8 MB (upstream constants).
- The inline diff pane is opened by **double-clicking** a change row (single
  click only selects; the selection bar is for stage/unstage/discard).
