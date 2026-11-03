# Implementation Plan — T1 Workspace Panel Shell + Code View/Search

> 技术设计与宿主契约以父任务 `10-29-workbench-plugin/design.md` 为准；设计稿 `designs/workbench.pen`（P1/P2/P5/P6/P7）。

## 1. 面板壳 + 启动进入

- [x] `lib/client.js`：ModuleLoader 工厂 + locale 注册 + `ctx.slots.inject('main', …)` 注册 `main` 面板（key `workbench`）+ `sidebar.panellist` 入口行。
- [x] 骨架：`Sidebar | (TabBar / Breadcrumb / Content) / StatusBar`，处理 `--dsh-frame-top-clearance`。
- [x] 启动进入：`config.startup`（默认 `'workspace'`）时 300ms 后 `ctx.layout.selectPanel('workbench')`；`'conversation'` 关闭该行为。实测刷新即落在工作台。
- [x] **S10 结论：客户端 `ctx.layout` 只有 `panels / hasMainPanel / panelInfo / navigation`，没有 `toggleSidebar`** → 不做程序化收起，dsh 左栏保持（面板自带「返回会话」按钮），即 design 的回退分支。
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
- [x] 右键菜单：打开 / 复制路径 / 在系统中打开（宿主 `path.reveal` op：绝对路径 + 存在性校验，argv 直调 `open -R` / `explorer` / `xdg-open`，拒绝相对路径与不存在路径，实测返回 `bad-path` / `not-found`）。
- [x] 单击打开 file tab（幂等，实测连点两次仍是一个 tab）。

## 5. Search tab

- [x] 宿主 `search` op（`src/search.ts`）：**引擎优先级 = 本机 rg → 内置 rg（`@vscode/ripgrep`，随包安装）→ JS 扫描回退**；`mode:'name'`（rg `--files` + 模糊打分）/ `mode:'content'`（rg `--json` 解析 + 字节偏移转列）；统一预算：忽略目录、单文件 ≤2MiB、500 条、4 并发（JS 路径）。`test/search.test.mjs` 7 条（含无 PATH rg 时走内置二进制、rg 与 JS 结果一致）。
- [x] 取消：客户端 `AbortController` 每次输入即 abort 上一次请求（宿主为有预算的扫描，无需 kill 子进程）。
- [x] UI：查询条（Aa / .* / 命中计数 / truncated 标注）+ 按文件分组命中 + 点击跳到文件并高亮该行；`Ctrl+Shift+F` 打开。
- [x] `Ctrl+P` 快速打开浮层（文件名模糊，上限 50，↑↓/Enter）。
- [x] glob 过滤：查询条加了 glob 输入（逗号分隔，回车重搜），透传给宿主 `globs`。

## 6. 代码视图

- [x] 单页读取（≤800 行）、行号 gutter（shiki 模式用 CSS counter）、面包屑、换行开关（按钮 + `Alt+Z`）、`Ctrl+G` 跳行（复用 `.line` 定位 + 高亮）；分页追加 / 当前行 / 缩进参考线未做。
- [x] shiki 初始化：`shiki/core` + JS regex engine，16 种语言 + GitHub Light/Dark 双主题，随宿主明暗（`class="dark"` / `data-ds-dark-theme`）用 MutationObserver 重渲染；超长行（>5k）与未知扩展名回退纯文本。实测 `.ts` 7 种 token 色、`.json` 159 个 token span。bundle gzip 305KB。
- [ ] `changes` 订阅：**试过但回滚** —— 按文档接 `remote.workspaceFiles.changes` 后，同一 tab 的文件读取卡在「读取中…」（订阅与读取争用/流形状未知），已还原，保留手动重载按钮。需要单独探针确认 `changes` 的流形状与并发语义再上。

## 7. Markdown 预览

- [x] markdown-it + GFM（table / task lists / strikethrough / footnotes / linkify）+ DOMPurify sanitize（raw HTML 关闭）；外链强制 `target=_blank rel=noreferrer`。
- [x] 代码块用同一 shiki 实例高亮（渲染后原地替换 `pre code`）。
- [x] 相对图片走宿主 `readBytes` → `URL.createObjectURL` blob（不暴露文件系统路径）；读不到时降级为 `[文件名]` 占位。
- [x] 预览 / 源码切换（按钮 + `Ctrl+Shift+V`）；按 tab 记忆滚动位置（切换回来恢复）；T3 复用组件未做。

## 8. 会话 / 终端 / 浏览器 tab

- [x] 会话：**真内嵌已打通**。照 `ui-subagent/sidebar-chat` 的受支持写法——面板声明 session 作用域 child slot（`workbench.conversation`）拿到 `SessionProvider` + `renderSlot`；`ctx.sessions.retain(sessionId, {source:'workbench'})` 得 `SessionReference`（tab 卸载时 release）；child 组件用 `renderFactorySlot('conversation.content', { variant:'embedded', phase, hero }, { slots:{ views } })` 渲染宿主对话。`contentId = sessionId` 保证同一 session 只一个 tab。实测 tab 内出现完整对话头 + composer + 发送按钮，`Guarded` 兜底回占位卡。
- [x] 终端：复用宿主 `ctx.webTerminals.view(sessionId, key, contentId)`（`dsh-api-terminal-controller` 的 `ClientTerminals` 服务），`mount/write/resize/acknowledge/close` 全用它，不自己起 PTY；frame 分 `snapshot`（先 `term.reset()` 再整屏写）/`output`（追加）/`state|ack`，写完 `acknowledge(revision)`。xterm + fit addon 打包进 bundle（S2），`ResizeObserver` 重排；关闭 tab 走 `close()` 结束进程，切换 tab 只 detach。实测：提示符出现、输入 `echo workbench-ok` 有回显。bundle gzip 406KB → 550KB。
- [x] 浏览器：iframe + 自管历史（后退/前进/刷新）+ 地址栏；非 http(s) 自动补 `https://`，非法输入不导航；`sandbox` + `referrerPolicy`；底部固定「部分站点禁止被嵌入」提示。实测 `+`→浏览器→输 `example.com`：iframe `src=https://example.com`、tab 标题同步为 `example.com`。

## 9. 验证

```powershell
pnpm build
dsh plugin --profile desktop add C:\projects\dsh-workspace\dsh-workbench
# 手工跑 T1 Acceptance Criteria
```

- [x] R1.1–R1.14 逐条实测（见文中各项）；未覆盖：分页追加（>800 行文件只读首页）、树的多选/拖拽、六屏叠图比对。
- [ ] 关闭面板后无遗留订阅（`ctx.effect` 清理、watch 解绑、子进程结束）。
- [ ] 六屏截图与设计稿叠图比对（容差：布局 ≤2px、颜色 ≤3ΔE）。
- [ ] 回滚点：每节结束一次本地提交。
