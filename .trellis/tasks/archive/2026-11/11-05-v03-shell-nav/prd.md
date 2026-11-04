# v0.3-D 外壳与导航：把断头路入口修好

父任务：`11-05-v03-iteration`（v0.3 迭代，D 组）。

## Goal

侧栏「添加项目」、`+` 菜单「新建项目」「打开文件」不再是点了报错/弹空 prompt 的断头路；插件自己的应用列表与宿主默认界面用同一套名字。

## 已确认事实

- 客户端其实有工作区创建接口：`ctx.workspaces.create({ path })`（返回 `WorkspaceView`，含 `workspaceId`），目录选择器是 `ctx.uiWorkspace.pickDirectory()`。v0.2 PRD 里"客户端没有注册工作区 API"的结论已过时。
- 旧实现：`addProject` 只找 `add`/`register` 方法（都不存在）→ 必定抛 `sidebar.addProjectUnavailable`；「打开文件」弹 `window.prompt` 输入绝对路径，没有补全也没有错误提示。
- `apps()` 用 `slots.entries('main')` 的 `options.key` 加本地字典猜名字，不用宿主自己的 label。

## Requirements

1. 「添加项目」/「新建项目」：先调宿主目录选择器；取消则不做事；拿到路径后 `ctx.workspaces.create({ path })`，成功时切换到新工作区。宿主没有选择器时退回手输路径。
2. 「打开文件」：打开插件自带的快速打开面板（QuickOpen），不再弹 prompt。
3. 应用列表：优先用宿主条目自带的 label，其次才用插件字典，最后才是 key 首字母大写。

## Acceptance Criteria

- [x] 点「添加项目」弹出系统目录选择器，选中后项目出现在侧栏并成为当前项目。
- [x] 取消选择不产生任何提示或空项目。
- [x] `+` 菜单「打开文件」打开快速打开面板（可搜索文件），不再要求输路径。
- [x] 应用列表显示宿主给出的名字。
- [x] `pnpm typecheck` / `pnpm test` 通过。

## 未完成项（宿主侧缺口，见父任务 `issues.md`）

- **隐藏左上角「切换侧栏」「新建会话」两个宿主按钮**：客户端没有对应 API；按钮在宿主自己的 leading seat 里，class 是构建期哈希的 CSS Module，插件只能用 DOM/CSS 硬改，违反"插件不改宿主 UI"的规范。记录待宿主提供开关。
- **双击标题栏最大化**：窗口是宿主用 `titleBarStyle: hiddenInset` 建的，拖拽区在宿主 DOM 里，插件无法修。
- **侧栏底部头像 + 用户名**：客户端没有账户/身份服务（catalog 里没有），拿不到用户名与头像。
- **应用在 tab 内打开**：需要把宿主 `main` 面板作为子面板渲染，宿主未提供该渲染入口；现在仍是跳到宿主面板。
