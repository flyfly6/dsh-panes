# Implementation Plan — Workspace Workbench Plugin (parent)

> 父任务负责「脚手架 + 集成 + 跨子任务验收」，功能实现分别在三个子任务里做。父任务本身不启动子任务的代码工作，只保证契约与环境就绪。

## 0. 前置门（在 `task.py start` 之前确认）

- [x] Spike S1/S2/S4/S5 已跑（结论见 `research/notes.md` §8）；S3/S6–S11 随子任务推进。
- [x] dsh 版本与插件接口确认：本机 CLI `0.2.1-rc.5`（基线 asar 为 `0.2.1-rc.3`，契约一致）。
- [x] 安装通道确认：`dsh plugin --profile <p> add <abs-path>`（pnpm 软链）+ 手工把包名加进 profile 的 `dsh.profile.bundles`。
- [x] 工具链：`git 2.39.1` 有；**`rg` 缺失** → 内容检索按 design 回退走 JS 扫描，性能不够再引入 `@vscode/ripgrep`。

## 1. 脚手架（父任务直接产出）

- [x] `package.json`：`name`、`version 0.1.0`、`type: module`、`main: lib/index.js`、`exports['./client']: lib/client.js`、`exports['./package.json']`、`dsh.bundle.patch`、`dsh.client{platform:'web', inject:[...]}`、`peerDependencies`、`files`。
- [x] `cordis.patch.yml`：`- insert: [{ id: workbench, name: dsh-workbench }]`。
- [x] `src/index.ts` → `lib/index.js`：cordis 插件（`/dsh-workbench/api` 路由 + `ping` / `config.get` op、信任围栏、`ctx.effect` 管理生命周期），`test/host.test.mjs` 覆盖。
- [x] `src/client.ts` → `lib/client.js`：ModuleLoader 工厂 + locale 内联字典 + `main` 面板 + `sidebar.panellist` 入口行。
- [ ] `locale/zh.json`、`locale/en.json`：暂缓 —— 无构建内联，字典先写在 `client.ts` 里；有 i18n 增长需求再拆文件。
- [ ] `NOTICE.md`：MIT 署名 + `dsh-ide-git` 来源与版本（fork 部分）。
- [ ] `.gitignore`、`README.md`（安装步骤、能力清单、已知限制、上游同步说明）。
- [x] 构建脚本：tsdown 产出 `lib/index.js` 与 `lib/client.js`；`pnpm build` / `pnpm typecheck` / `pnpm test` 就绪。

## 1b. Vendor `dsh-ide-git`（fork 底座，父任务产出）

- [ ] 取上游 v0.21.1（`https://github.com/KannaKuron/dsh-ide-git`）到 `src/git/`：宿主半存为 `src/git/host.js`（导出 cordis 插件），客户端面板存为 `src/git/panel.js`（导出 `GitPanel` 组件 + 需要复用的纯函数）。
- [ ] 记录 `src/git/UPSTREAM.md`：同步基线（版本/commit）、我们的修改点清单、同步后要跑的验收项。
- [ ] 首次改造三处：① 去掉 `window.__ModuleLoader__.load` 自注册，改为模块导出；② 注册方式换成我们的 `workbenchTabs` + `views`；③ 删除「主对话区 Git 标签页」路径与 betterSidebar 分支。
- [ ] 宿主侧：`ctx.plugin(gitHost)` 挂载，保留 `/dsh-ide-git/api` 前缀路由与全部守卫；确认与自有路由不冲突（不同前缀）。
- [ ] 验证：装进 Desktop 后被 `git` tab 打开一次，能拿到 `summary` + `branches` + `log` 三段数据（S6）。

**验证**：本地安装后刷新客户端 → 左侧栏出现 Workspace 面板行，点击进入空面板，控制台无报错；`git status` 干净。

## 2. 子任务推进顺序

1. **T1 `10-29-workspace-panel-shell`**（父任务先合入项目侧栏 + tab 工作区骨架、tab 模型与 `workbenchTabs` 契约）
   - 产出：项目侧栏（可拖宽/折叠 + 应用区）+ tab 条（`+` 菜单）+ 面包屑 + 状态栏；Explorer / Search tab；代码高亮视图；Markdown 预览；会话/终端/浏览器 tab。
2. **T2 `10-29-git-client`**（把 §1b vendor 进来的面板接成 `git` tab）
3. **T3 `10-29-global-notes`**（`note` tab + `notes` 列表 tab + 宿主 notes op）

每个子任务完成时，父任务做一次集成复核（见第 4 节），再进入下一个。

## 3. 回归验证命令

```powershell
# 1) 构建
pnpm install; pnpm build

# 2) 安装进 Desktop profile（本地目录）
dsh plugin --profile desktop add C:\projects\dsh-workspace\dsh-workbench   # 或走客户端插件页

# 3) 冒烟：宿主 API 可达（需要客户端同源的会话 token，实操以浏览器为准）
Invoke-WebRequest -Uri http://127.0.0.1:57438/ -UseBasicParsing   # 期望 200；401 说明需要重开带 token 的 URL

# 4) 卸载回滚
dsh plugin --profile desktop remove dsh-workbench
```

手工验收清单（每次集成后跑一遍）：

- [ ] 打开文件 → 高亮正确、行号对齐、换行开关生效；Explorer 自动展开并高亮该文件
- [ ] 打开 `.md` → 渲染视图正确、可切源码、相对图片能显示
- [ ] 内容检索 → 命中数正确、点击定位行号正确、可取消
- [ ] 终端 tab → 能起 shell、能跑命令、关闭后进程结束
- [ ] 浏览器 tab → 能打开 URL、后退/刷新可用
- [ ] Git（T2）→ 分支树 / 图谱 / 变更分组 / 提交框同屏；stage → commit 闭环后状态与图谱同步；动作条在窄容器下收纳进 `⋯`；push/pull 不可见
- [ ] 笔记（T3）→ 新建 → 编辑 → 刷新后仍在 → 跨工作区可见；侧栏 Notes 视图可达
- [ ] 刷新页面 → tab 布局 + 侧栏当前视图与宽度恢复
- [ ] 禁用/卸载 → 宿主启动无报错

## 4. 风险点与回滚点

| 节点 | 风险 | 回滚 |
|---|---|---|
| 第 1 节脚手架 | 面板注册不上 / ModuleLoader id 不匹配 | 保留最小可注册面板，删掉其余代码，先证明入口可用 |
| 1b vendor | 上游面板与注册层耦合比预期深，改三处仍跑不通 | 退回「只依赖 dsh-ide-git + 我们的 Git 视图做跳转入口」，T2 范围收窄为封装与验收 |
| 1b vendor | 后续上游升级难以合并 | 冻结版本 + `UPSTREAM.md` 记录补丁点，按需升级而非跟版 |
| T1 侧栏同步 | 自动 reveal 打断用户浏览 | 关掉自动 reveal，只留「在文件中显示」按钮 |
| T1 终端 tab | xterm 不可用或 controller 不可附着 | 降级为「跳转右侧栏终端」按钮，tab 类型先不提供 |
| T1 浏览器 tab | Desktop webview 不可编程创建 | 只用 iframe，并在 README 注明 Desktop 下以 iframe 语义运行 |
| T1 内容检索 | rg 二进制缺失 | 回退 JS 扫描，限并发/限大小，保证功能不断 |
| T2 git | 仓库很大导致 status 慢 | 上游已有分页与 400KB diff 截断；再加超时与提示 |
| T3 笔记 | 用户 vault 是 Obsidian 库，含非笔记文件 | 只索引 `.md`，其余忽略；不写非本插件创建的文件 |

## 5. 交付前检查

- [ ] `prd.md` 的跨子任务 Acceptance Criteria 全部勾选。
- [ ] 三个子任务各自 `task.py archive` 完成后，父任务再做一次完整回归。
- [ ] 记录一条 spec：把「dsh 插件如何注册全屏 main 面板 + 宿主 HTTP 路由契约」写进 `.trellis/spec/`（`trellis-update-spec`），避免下次重新逆向 asar。
