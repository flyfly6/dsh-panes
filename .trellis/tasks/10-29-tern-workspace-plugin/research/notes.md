# Research Notes — dsh 插件能力取证（2026-10-29）

来源：本机 DeepSeek Harness Desktop（dsh `0.2.1-rc.3`，Electron `app.asar`），GUI `http://127.0.0.1:57438`，profile `desktop`。

## 1. 如何从 app.asar 取文件（可复用）

`app.asar` = 8 字节头 + header pickle + 数据区：

- 偏移 0..4：`UInt32LE` = 4
- 偏移 4..8：`UInt32LE` = header pickle 大小 `H`（本机 4748096）
- 偏移 8..8+H：header pickle，其前 4 字节是 JSON 长度，随后是 JSON（asar 目录树）
- 数据区起点 = `8 + H`；JSON 中每个文件节点的 `offset` 相对数据区起点，`size` 为字节数

PowerShell 读法见本任务历史命令（`[System.IO.File]::OpenRead` + `BitConverter`，`ConvertFrom-Json` 前要跳过 JSON 前的 4 字节长度）。已知文件示例：

- `dsh/package.json`、`dsh/node_modules/@deepseek-ai/<pkg>/{README.md,package.json,lib/client.js}`
- 顶层 `renderer/`、`dsh/desktop-runtime.json`

已提取到 `research/dsh-asar/` 的参考包：`dsh-client-modules`、`dsh-client-ui-layout`、`dsh-client-ui-sidebar{,-browser,-terminal,-documentpreview,-files}`、`dsh-client-ui-plugin-manager`（含 `lib/client.js` 参考实现）、`dsh-client-ui-workspace`、`dsh-api-workspace-files`、`dsh-experimental-terminal-bundle`。

## 2. 插件契约（结论）

- 包结构：`main: lib/index.js`（宿主半边）+ `exports["./client"]: lib/client.js`（浏览器半边）+ `dsh.bundle.patch` → `cordis.patch.yml` 的 `- insert:` 行 + `dsh.client{platform:'web', inject:[...], external?:[...]}`。
- 客户端 bundle 形态：`const factory = (require) => { ...; return module.exports }; window.__ModuleLoader__.load({ id, factory })`，id 要与 Loader entry 的 id 一致（官方包用自己的包名）。
- 运行时 API 名：`ctx.slots`（`register/inject/entries/subscribe/getVersion`）、`ctx.layout`（`selectPanel/panelInfo/openRightbar`）、`ctx.locale`、`ctx.remote`、`ctx.reflect.provide`、`ctx.effect`、`ctx.get('slots')`（第三方写法）。
- **全屏主面板注册**（官方 `ui-plugin-manager` 的写法，`lib/client.js` 第 ~4411 行）：

```js
ctx.slots.inject("main", function* () {
  const handle = createNavigationStore(), instance = handle.create()
  yield ctx.slots.register({
    name: "main", key: PANEL_ID, locale: NS, store,
    inject: () => face,
    children: { "plugins.item": { kind: "list", scope: "root" }, ... },
  }, PageComponent)
})
ctx.layout.selectPanel(PANEL_ID)
```

`ui-sidebar`（`lib/client.js` 第 ~204 行 `PanelRow`）遍历 `main` 面板生成左侧栏「全局面板」行，图标来自 `sidebar.panellist` slot —— 所以注册 `main` 面板即自动获得入口。

- 右侧栏 tab 类型：`ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({...}))`；打开 tab `ctx.sidebarRight.openTab('browser', { params: { url } })`；tab 类型注册表 `ctx.sidebarRightTabs.register(...)`。

## 3. 数据能力

`remote.workspaceFiles`（`@deepseek-ai/dsh-api-workspace-files`）：

| 方法 | 语义 |
|---|---|
| `read(sessionId, path, {offset,limit})` | 按行分页，带 `version/lines/eof`；拒绝非 UTF-8 与 NUL |
| `readBytes(sessionId, path, {range,baseFile})` | 字节窗口/整文件（cap 32 MiB） |
| `stat(sessionId, path)` | `{absolutePath, version, bytes}` |
| `list(sessionId, path)` | **仅直接子项**，目录必须工作区内 |
| `changes(sessionId, path)` | watch 流（文件/目录，目录仅直接子项） |

→ 没有递归/内容搜索，插件必须自己做（rg 或 JS 扫描）。

## 4. 已存在但形态受限的能力

- 右侧栏 = per-session dock，宽 264–420px，四种 tab 类型：Files / Document Preview（含 Markdown、代码 paged text、图片、PDF、Office、HTML）/ Terminal（xterm + 宿主 PTY）/ Browser（Web iframe、Desktop `<webview>`）。
- 无法把会话放进 dock（会话是主区 `conversation` 面板）。

## 5. 缺口清单（= 本插件价值）

1. 统一的全屏 tab 工作台（跨内容类型、可持久化布局）
2. 客户端侧项目文件内容检索 UI
3. Git 客户端（status/diff/graph/stage/commit/branch/fetch）
4. 全局 Notion 风格 Markdown 笔记

## 6. 环境注意- 桌面端安装通道：npm CLI 拒绝 `--profile desktop`，需用 Desktop 自带 command runtime 或客户端「插件」页的本地目录安装。
- Web GUI 需要 URL 里的会话 token，直接 `Invoke-WebRequest http://127.0.0.1:57438/` 返回 401 并提示重开 `dsh web` 打印的 URL。
- `~/.dsh/profiles/node_modules/@deepseek-ai/*` 里大量 junction 指向 fnm 全局安装，可能是悬空链接；真正可信的参考实现在 `app.asar` 内。

## 7. 上游参考实现：dsh-ide-git（fork 来源）

`https://github.com/KannaKuron/dsh-ide-git`，MIT，抓取时版本 **v0.21.1**（package.json 与 dsh.plugin.json 一致，id `dsh-external/dsh-ide-git`）。

- 形态：`main: src/index.js`（宿主半）+ `exports['./client']: src/client.js`（客户端半，**无构建单文件**）+ `cordis.patch.yml`（`- insert: [{ id: ide-git, name: 'dsh-ide-git' }]`）+ `exports['./package.json']`（缺了客户端进不了 boot graph，上游 issue #2）。
- 宿主半：前缀路由 `POST /dsh-ide-git/api/<method>`，方法表约 32 个（`summary/branches/log/commitDetail/diff/compare/stage/commit/checkout/branch*/tag*/stash*/fetch/pull/push/reset/revert/cherry-pick/commit-models/commit-efforts/version` …）；全部 `spawn('git', argv)`，无 shell 字符串；同仓写操作串行；diff 输出上限 400KB；含「AI 生成提交信息」特性（`ctx.inject(['llm','sessions'])`，模型与 effort 走 row Config）。
- 客户端半：`window.__ModuleLoader__.load({ id, factory })`，`require` 仅限白名单（react / react/jsx-runtime / react-dom / @deepseek-ai/cordis / dsh-client-store / dsh-client-ui-slots / dsh-client-ui-primitives）；`ui-primitives` 是 try/catch 可选依赖（`DiffBlock`、`FileTypeIcon`），缺失时自带降级。
- 挂载：装了 `dsh-better-sidebar` 走它的 Tab 系统（右侧栏 + 底部工作台），否则落原生右侧栏 Guide；v0.13.0 起还能挂「主对话区 Git 标签页」。
- 布局：`ResizeObserver` 量自身，宽 ≥600px 且宽 ≥ 高×1.15 → `columns`（三栏），否则 `stack`；不猜容器。
- 交互资产（我们要保留的）：IDEA 列序提交列表 + lane 图谱、分支树分组与右键、变更四分组 + 提交框 + `--amend`、动作条按高度收纳 + `⚙` 排序显隐、删除分支/贮藏 30 分钟可撤回、21 语言词典、diff 选区右键「发送到对话」（依赖 `ctx.get('conversation')` 的 composer facade，**fork 时按需保留**）。
- 明确不做的（上游自称）：交互式 rebase、三方冲突编辑器、submodule/LFS、blame、worktree 视图、多选批量操作、部分提交。
- fork 决策（D8）：两半整体 vendor 进 `src/git/`，注册改造为我们的 `git` tab + `views` 视图；push/pull 默认隐藏（`experimentalRemoteOps` 开关）；`src/git/UPSTREAM.md` 记录同步基线与补丁点。
