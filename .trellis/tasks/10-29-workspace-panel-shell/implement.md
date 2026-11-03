# Implementation Plan — T1 Workspace Panel Shell + Code View/Search

> 技术设计与宿主契约以父任务 `10-29-workbench-plugin/design.md` 为准；设计稿 `designs/workbench.pen`（P1/P2/P5/P6/P7）。

## 1. 面板壳 + 启动进入

- [x] `lib/client.js`：ModuleLoader 工厂 + locale 注册 + `ctx.slots.inject('main', …)` 注册 `main` 面板（key `workbench`）+ `sidebar.panellist` 入口行。
- [x] 骨架：`Sidebar | (TabBar / Breadcrumb / Content) / StatusBar`，处理 `--dsh-frame-top-clearance`。
- [ ] 启动进入：`config.startup === 'workspace'`（默认）时 layout ready 后 `selectPanel('workbench')`，并收起 dsh 左栏（S10 结论决定是否可程序化）。
- [x] 返回：`selectPanel(null)`；`Esc` 仅在面板聚焦且无弹层时生效（左栏恢复随上一项一起做）。
- [x] 验证：安装 → dsh 左栏出现入口 → 打开即进入 → 控制台无报错（S1）。

## 2. 项目模型 + 侧栏

- [x] 读宿主 workspace 注册表（`useWorkspaces(s => s.items)`）→ 项目列表（名称/路径/tab 数）；running 标记未做。
- [x] 侧栏 UI：头部（返回 / PROJECTS / 折叠）、过滤框、项目行、底部「应用」区（`ctx.slots.entries('main')`，S11）；`Add project` 未接宿主目录选择器。
- [x] 拖拽调宽（200–320，3px 热区，双击复位）+ 折叠成 52px 图标条；宽度与折叠态持久化（已实测刷新恢复）。
- [x] 切换项目：切换整套 tab 集合（实测 A 项目 2 tab → 切 B 空 → 切回 A 恢复）。

## 3. tab 模型 + `+` 菜单

- [x] `tabs` store（`src/tabs.ts` 纯函数 + `test/tabs.test.mjs` 8 条）：`open/close/activate/rename/move/reopenLast`，按 `${projectId}:${kind}:${contentId}` 去重。
- [x] `workbenchTabs` 注册表（`ctx.provide('workbenchTabs', registry)`，`register({kind, order, render})`）。
- [x] `+` 菜单：Session / Open file / Explorer / Search / Terminal / Browser / Source Control / Note（New note / New project 待接）。
- [x] localStorage `schemaVersion: 2`（activeProjectId + projects 映射）；读回时丢弃未知 kind、越界宽度。
- [x] 快捷键：`Ctrl+Tab` / `Ctrl+W` / `Ctrl+Shift+T` / `Ctrl+B`（终端未接入，暂无让位逻辑）；`Ctrl+P` / `Ctrl+Shift+F` 未做。

## 4. Explorer tab

- [x] 树：懒加载 `workspaceFiles.list`（`remote.workspaceFiles` 客户端接口）；折叠状态仅内存、忽略目录与类型图标未做。
- [ ] 右键菜单：打开 / 在树中定位 / 复制路径 / 在系统打开。
- [x] 单击打开 file tab（幂等，实测连点两次仍是一个 tab）。

## 5. Search tab

- [x] 宿主 `search` op（`src/search.ts`）：**引擎优先级 = 本机 rg → 内置 rg（`@vscode/ripgrep`，随包安装）→ JS 扫描回退**；`mode:'name'`（rg `--files` + 模糊打分）/ `mode:'content'`（rg `--json` 解析 + 字节偏移转列）；统一预算：忽略目录、单文件 ≤2MiB、500 条、4 并发（JS 路径）。`test/search.test.mjs` 7 条（含无 PATH rg 时走内置二进制、rg 与 JS 结果一致）。
- [x] 取消：客户端 `AbortController` 每次输入即 abort 上一次请求（宿主为有预算的扫描，无需 kill 子进程）。
- [x] UI：查询条（Aa / .* / 命中计数 / truncated 标注）+ 按文件分组命中 + 点击跳到文件并高亮该行；`Ctrl+Shift+F` 打开。
- [x] `Ctrl+P` 快速打开浮层（文件名模糊，上限 50，↑↓/Enter）。
- [~] glob 过滤：宿主已支持 `globs` 入参，UI 尚未暴露输入框。

## 6. 代码视图

- [x] 单页读取（≤800 行）、行号 gutter（shiki 模式用 CSS counter）、面包屑、换行开关；分页追加 / 当前行 / 缩进参考线 / `Ctrl+G` / `Alt+Z` 键位未做。
- [x] shiki 初始化：`shiki/core` + JS regex engine，16 种语言 + GitHub Light/Dark 双主题，随宿主明暗（`class="dark"` / `data-ds-dark-theme`）用 MutationObserver 重渲染；超长行（>5k）与未知扩展名回退纯文本。实测 `.ts` 7 种 token 色、`.json` 159 个 token span。bundle gzip 305KB。
- [ ] `changes` 订阅：外部修改提示「已变化，点击重载」（重载按钮已在，订阅未接）。

## 7. Markdown 预览

- [ ] markdown-it + GFM + sanitize；相对图片经 `/api/file`；代码块接 shiki。
- [ ] 预览/源码切换 + `Ctrl+Shift+V`，滚动位置记忆。
- [ ] 导出一套块渲染组件，供 T3 的 Notion 编辑器复用。

## 8. 会话 / 终端 / 浏览器 tab

- [ ] 会话：`SessionProvider` + 宿主 `Conversation.View`；先按 S9 结论决定「双实例」还是「portal 换宿主」。
- [ ] 终端：复用 terminal controller（list → attach → 读写）；关闭调终止；不可用降级为跳转按钮。
- [ ] 浏览器：iframe + 自管历史 + 地址栏；URL 只允许 http/https。

## 9. 验证

```powershell
pnpm build
dsh plugin --profile desktop add C:\projects\dsh-workspace\dsh-workbench
# 手工跑 T1 Acceptance Criteria
```

- [ ] R1.1–R1.14 全通过。
- [ ] 关闭面板后无遗留订阅（`ctx.effect` 清理、watch 解绑、子进程结束）。
- [ ] 六屏截图与设计稿叠图比对（容差：布局 ≤2px、颜色 ≤3ΔE）。
- [ ] 回滚点：每节结束一次本地提交。
