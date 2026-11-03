# Implementation Plan — T2 Git Client (JetBrains 风格)

> 前置：父任务 §1b 已把上游两半 vendor 进 `src/git/`。设计与 fork 边界见父任务 `design.md` §3.4；本文件只列接入步骤与验证。
> 状态：**已实现**（2026-11-03）。改动点全表见 `src/git/UPSTREAM.md`。

## 1. 宿主半接入

- [x] `src/index.ts` 中 `ctx.effect(() => { const fiber = ctx.plugin(gitHost, config); return () => fiber.dispose() })` 挂载；`inject` 只有 `webServer`，缺 llm/sessions 仍能加载（AI 提交信息自动降级）。
- [x] `/dsh-ide-git/api` 与 `/dsh-workbench/api` 两个前缀路由共存，无冲突（实测同页同时可用）。
- [x] 配置合并：`src/config.ts` 生成 row schema（`RAIL_CONFIG_IDS` + `commitModel/commitReasoning/commitPrompt` + `experimentalRemoteOps`）；`conversationTab`/`immersive`/`composerStatus` 三个 placement 字段及其写入点删除。
- [x] `experimentalRemoteOps: boolean = false`：宿主侧 `assertRemoteOpsAllowed` 对 push/pull/pushTags/remote*/commit--push 返回 `disabled-by-config`（403），实现保留。
- [x] 上游两处空仓库缺陷修补：unborn branch 用 `symbolic-ref --short HEAD` 兜底；`log` 把 "does not have any commits yet" 视为空历史。

## 2. 客户端面板接入

- [x] `src/git/panel.js` 导出 `createGitPanel(require)`，返回 `{ apply, Panel, LocaleLive, translate }`；`src/git/tab.tsx` 是适配层，`src/client.tsx` 里 `workbenchTabs.register({kind:'git', order:30, render})`。
- [x] 不注册侧栏视图：分支树与变更列表都在 `git` tab 内部渲染。
- [x] 移除上游四处：`window.__ModuleLoader__.load` 自注册、`betterSidebar.registerTab` / 原生右侧栏座位、`conversation.view` 座位、输入框 Git 状态胶囊。
- [x] 面板自量容器（`ResizeObserver`），阈值沿用上游 600 / 1.15；`git` tab 内容区 752×479 时实测为 columns 三栏。
- [x] 保留上游按 tab 缓存与 12s 轻量刷新（`visible: true` 传入即启用）；切 tab 不重复拉全量 log。

## 3. 状态栏与配置页联动

- [x] 状态栏左侧显示分支 + `±n` 改动数（`summary` 走 `stats:false`，15s TTL，按项目路径共享），点击切到 git tab；未提交数作为 tab 角标。
- [x] 变更文件双击 → 上游内嵌 diff 窗（`previewDiff` 三条座位通道都不存在时自动回退到 inline）。**偏差**：没有走「file tab + `params.view='diff'`」——T1 的文件视图没有 diff 模式，把 diff 交给上游自己的窗格更省且带 hunk 高亮/行号/拖拽。
- [x] 配置页字段接线：`rail*`（动作条顺序与显隐，上游设置卡自带）、`commitModel/commitReasoning/commitPrompt`（AI 提交信息）、`experimentalRemoteOps`（新增「远程操作」分组）。

## 4. 上游同步机制

- [x] `src/git/UPSTREAM.md`：基线 v0.21.1、改动点清单（宿主挂载、注册改造、命名空间、配置字段、远程开关、空仓库兜底）、同步步骤、同步后必跑清单。
- [x] 改动集中在两处：`src/git/tab.tsx` + `src/git/status.ts` 适配层；上游文件内的显式标记注释 `// [workbench-fork]`（`grep -c` 可数）。
- [x] `NOTICE.md` + `src/git/LICENSE`（MIT 署名随包发布）。

## 5. 验证

```bash
pnpm check                      # build（2 个 half）+ typecheck + node --test
dsh --profile workbench-spike --no-open --port 57453
```

- [x] 真实仓库（dsh-workspace，17 处改动）：分支树 `main → origin/main ↑17`、提交列表 10 条、变更 7 + 未跟踪 10 与 `git status` 一致。
- [x] 暂存单文件 → 「已暂存 1 / 更改 6 / 未跟踪 10」，无需手动刷新；`全部取消暂存` 回滚后 `git status` 无 staged 条目（索引已复原）。
- [x] 双击变更文件 → 内嵌 diff 窗显示内容（DOM `.dig-diff-pane`）。
- [x] `experimentalRemoteOps` 关闭：动作条无拉取/推送、提交框无「提交并推送」、`POST push` → 403 `disabled-by-config`；在设置页打开开关后（写入成功、无报错）动作条出现拉取/推送、提交框出现「提交并推送」；再关回去恢复隐藏。
- [x] 设置卡分组 = 动作条 / 远程操作 / AI 提交信息（placement 分组已移除）。
- [x] 空仓库（`git init` 无提交）：`summary` 返回分支名 + 0 改动，`log` 返回空列表（`test/git.test.mjs` 覆盖）。
- [x] 非仓库目录：`summary` 返回可读错误码，不抛未捕获异常。
- [x] 关闭再打开 tab 不重复挂载：宿主半由 `apply` 挂一次，客户端 `gitModule()` 记忆化 + `apply` 只调一次。
- [ ] 未单独验证（上游既有行为，未改动）：带 merge 提交仓库的 lane 拓扑、标签/远程分支徽章、30 分钟撤回浮窗、400px 窄容器收纳、>5k 改动文件的分页提示。
- [ ] 未验证：`fetch` 无网络时的失败提示（需要断网环境）。

## 6. 回滚点

三次提交，可单独回退：① `feat(t2): mount the forked git host half`（宿主 + 配置 + 测试）② `feat(t2): the git tab, badge and status-bar branch`（客户端 + 适配层）③ `docs(t2): upstream sync notes and notices`。
