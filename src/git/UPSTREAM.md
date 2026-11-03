# Upstream: dsh-ide-git

**Status (2026-11-03): 分叉维护中 — 不再同步上游。** 这棵树是 `dsh-workbench`
自己的 Git 面板基线；此文件只记录**来源、署名与我们的变更**。样式对齐与按需重构见
`.trellis/tasks/11-03-git-tab-native/prd.md`（T6）。

We forked **[KannaKuron/dsh-ide-git](https://github.com/KannaKuron/dsh-ide-git)** v0.21.1
(MIT — see `LICENSE`, which is upstream's file, unmodified) into `src/git/`.

| file | upstream | what it is |
| --- | --- | --- |
| `src/git/host.js` | `src/index.js` | host half: `/dsh-ide-git/api/<method>`, ~48 git methods, argv-only `spawn`, per-repo write queue |
| `src/git/panel.js` | `src/client.js` | browser half: the whole Git tool window (branch tree, commit graph, diff, changes, commit box, action rail) |
| `src/git/LICENSE` | `LICENSE` | upstream MIT text |

Sync baseline: tag `v0.21.1`, upstream files copied verbatim, then the edits below.
The edits made *while this was still a fork* are marked `[workbench-fork]` in place;
since 2026-11-03 the tree is ours, so new changes are recorded here only.

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

## 所有权：这棵树现在是我们的

不再有「同步上游」流程。规则只有三条：

1. **直接改**。`src/git/panel.js` / `src/git/host.js` 是普通源文件，改样式、抽组件、删代码都不需要再留 `[workbench-fork]` 标记——整棵树都是我们的。
2. **改完记一条**。新增/移除的能力、行为变化，追加到上面的变更表；`NOTICE.md` 与 `LICENSE` 不动（MIT 署名）。
3. **上游只当参考**。若某个上游修复确实需要，按「读上游 diff → 手工移植到我们这棵树 → 上面记一条」处理，**不要**重放整套补丁，也不要把文件换回上游版本。

### 每次改动后跑什么

```bash
node --check src/git/panel.js        # 单文件脚本仍需可解析
pnpm check                          # build + typecheck + node --test
```

GUI 冒烟（T2 的验收清单，任何一次面板改动都跑一遍）：

1. 打开 `git` tab：分支树、提交列表、变更分组、提交框同屏。
2. stage → unstage → 双击改动文件看 diff。
3. 设置页：动作条分组、远程操作开关（关 → push/pull 三处都不出现，宿主 403）。
4. 空仓库（`git init` 无提交）与非仓库目录各开一次，只出可读错误。

## Known upstream behaviour we did not change

- Repo discovery scans the workspace for repositories, so a workspace that is a
  *parent* of repositories shows a picker (`repo.pick`) rather than an error.
- `patch` is capped at 400 KB and `git` output at 8 MB (upstream constants).
- The inline diff pane is opened by **double-clicking** a change row (single
  click only selects; the selection bar is for stage/unstage/discard).
