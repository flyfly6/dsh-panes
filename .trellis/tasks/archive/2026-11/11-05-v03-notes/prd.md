# v0.3-B 笔记：按项目隔离、名称一致、移动与 reveal

父任务：`11-05-v03-iteration`（v0.3 迭代，B 组）。

## Goal

笔记按项目分文件夹存放并互相隔离，名称在列表 / tab / breadcrumb 三处一致，能把一条笔记移动到另一个项目，能在文件管理器里定位它。

## 已确认事实

- vault 之前是**扁平的**：`src/notes.ts` 的 `walk(base)` 扫整个 vault，所有项目共用一份列表。
- 宿主已有 `notes.rename`（frontmatter `title` + 同目录换 slug）和 `path.reveal`（绝对路径 → `open -R` / `explorer`），缺的是项目维度与客户端接线。
- 客户端 `noteTitle(path)` 用**文件名**当 tab 标题，而列表用 **frontmatter title**——这就是"三处名字不一样"的根因。
- 编辑器里改标题只写 frontmatter，不改文件名，所以 tab 标题不会跟着变。

## Requirements

1. **按项目分文件夹**：笔记落在 `<vault>/<basename>-<hash6>/`；hash 基于项目绝对路径，同名不同项目不会撞车。无项目时用 `_inbox`。
2. **列表 / 搜索按项目隔离**：`notes.list` / `notes.search` 接 `projectPath`，只扫本项目目录。
3. **旧笔记迁移**：v0.2 及以前的扁平笔记在进程内首次访问时移进 `_inbox`，不删除任何文件。
4. **名称一致**：列表打开时把 frontmatter title 传给 tab；编辑器加载/保存后把标题回推给 shell（`retitle`），tab 与 breadcrumb 随之更新。
5. **移动到其他项目**：新增 `notes.move`，列表右键菜单列出其它项目 + `_inbox`。
6. **在文件管理器中显示**：右键菜单调用 `path.reveal`（vault 绝对路径 + rel）。

## Acceptance Criteria

- [x] 两个项目的笔记在不同目录，A 项目列表看不到 B 项目的笔记，搜索也不串项目。
- [x] 移动后源项目列表为空、目标项目出现该笔记，文件内容不变。
- [x] 打开笔记后 tab 标题 = frontmatter title；在编辑器里改标题并保存，tab 与 breadcrumb 立即改名。
- [x] 旧扁平笔记不会被删掉（迁移进 `_inbox`）。
- [x] `pnpm typecheck` / `pnpm test` 通过（新增一条项目隔离 + 移动的用例）。

## Non-goals

- 不做笔记树/多级目录（一个项目一个目录就够）。
- 不做跨项目拖拽。
- 不改 BlockNote 编辑器内核。

## 已知遗留（详见父任务 `issues.md`）

- 笔记被重命名/移动后，已经打开的旧 tab 会指向失效路径（列表会打开新路径，旧 tab 留在那里）。
- "笔记页面左侧操作按钮尺寸太大" 指的到底是编辑器块侧菜单还是列表工具栏，待用户确认。
