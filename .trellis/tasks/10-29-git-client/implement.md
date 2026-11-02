# Implementation Plan — T2 Git Client (JetBrains 风格)

> 前置：父任务 §1b 已把上游两半 vendor 进 `src/git/`。设计与 fork 边界见父任务 `design.md` §3.4；本文件只列接入步骤与验证。

## 1. 宿主半接入

- [ ] `lib/index.js` 中 `ctx.effect(() => ctx.plugin(gitHost, config))` 挂载（不用 `ctx.inject` 硬依赖，缺 llm/sessions 时仍能加载）。
- [ ] 确认 `/dsh-ide-git/api` 与自有 `/dsh-workbench/api` 两个前缀路由共存，无「duplicate prefix route」。
- [ ] 配置合并：上游 row Config（rail 顺序/显隐、commitModel、commitEfforts 等）并入我们的插件 schema；删除 `conversationTab` / `immersive` 两个 placement 字段及其写入点（否则宿主会以「字段未声明」拒绝写入）。
- [ ] 新增 `experimentalRemoteOps: boolean = false`，宿主侧据此在 `METHODS` 暴露表里屏蔽 `push` / `pull`（返回 `disabled-by-config`），而不是删掉实现。

## 2. 客户端面板接入

- [ ] `src/git/panel.js` 导出 `GitPanel`；`lib/client.js` 里 `workbenchTabs.register({kind:'git', create: () => ({component: GitPanel, title: t('tab.git')})})`。
- [ ] 不注册侧栏视图：分支树与变更列表都在 `git` tab 内部渲染（项目侧栏只放项目）。
- [ ] 移除上游三处：`window.__ModuleLoader__.load` 自注册、`ctx.betterSidebar.registerTab` / 原生右侧栏分支、主对话区 Git 标签页。
- [ ] 适配容器：面板自己用 `ResizeObserver` 量外框；我们的编辑区高度已扣掉 tab 条与状态栏，确认 `columns|stack` 阈值仍合理（必要时按实测调 600 / 1.15）。
- [ ] 缓存/刷新：保留上游的按 tab 缓存与 5s 轻量刷新策略；确保切 tab 不重复请求全量 log。

## 3. 状态栏与配置页联动

- [ ] 状态栏左侧显示分支名 + `+n/−n`，点击切到 Git tab；未提交数作为 tab 角标。
- [ ] 变更文件点击 → `tabs.openTab({kind:'file', contentId: <file>, params:{view:'diff', staged?}})`，由 T1 的文件类型按 `params.view='diff'` 渲染 diff（与上游 DiffBlock 一致）。
- [ ] 配置页「Git」页字段接线：`git.aiCommit.*` / `git.rail` / `git.behavior.*` / `git.experimentalRemoteOps`（见父任务 §2.0f）。

## 4. 上游同步机制

- [ ] 写 `src/git/UPSTREAM.md`：基线版本/commit、改动点清单（宿主挂载、注册改造、配置字段、远程操作开关）、同步步骤、同步后必跑清单。
- [ ] 我们的改动尽量集中：`src/git/adapter.js`（注册与配置桥接）+ 少量上游文件内的显式标记注释（`// [workbench-fork]`），便于 diff。

## 5. 验证

```powershell
pnpm build
dsh plugin --profile desktop add C:\projects\dsh-workspace\dsh-workbench
```

- [ ] 在 dsh-workspace 自身仓库：改一个文件 → 出现在「更改」→ 暂存 → 提交 → 图谱出现新提交。
- [ ] 带 merge 提交的仓库：lane 拓扑正确、tag/远程分支徽章正确、提交详情 diff 正确。
- [ ] 窄容器（400px）与宽容器（≥1000px）两种形态下布局正确、动作条收纳正确。
- [ ] `experimentalRemoteOps` 关闭时 `push`/`pull` 不可见且宿主返回 `disabled-by-config`；`fetch` 无网络时报错可读。
- [ ] 非 git 目录 / 无 git / 仓库忙（存在 merge 中）三条错误路径有提示。
- [ ] 并发点两次 stage 不产生 `index.lock`（同仓串行队列生效）。
- [ ] 面板关闭再打开，宿主侧监听与队列未重复注册。
- [ ] 回滚点：宿主接入与客户端接入分两次提交；配置合并单独一次提交。
