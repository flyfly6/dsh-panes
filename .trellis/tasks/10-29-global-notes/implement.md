# Implementation Plan — T3 Global Markdown Notes (Notion 式)

> 宿主路由与 `op` 分发由 T1 建立；本任务新增 `notes.*` op、配置项、`note` 与 `notes` 两个 tab 类型。设计约束见父任务 `design.md`，设计稿 `lgBsZ` / 深色 `AfEbo`。

## 1. 宿主笔记服务

- [ ] `lib/host/notes.js`：库目录解析（配置值 → `$DSH_HOME/notes`），不存在则 `mkdir -p`；路径校验：绝对路径、`realpath` 后仍须位于库内、拒绝 `..` 与符号链接穿越。
- [ ] `notes.list`：递归列出 `.md`（跳过 `.trash`），读 frontmatter（轻量 `---` 区块解析，不引大依赖），返回 `{ relPath, title, updatedAt, size, excerpt }`。
- [ ] `notes.read` / `notes.write`：读返回 `{ text, mtimeMs, etag }`；写用原子写（临时文件 + `rename`），写前校验 `etag`，不一致返回 `notes/conflict`。
- [ ] `notes.create` / `notes.rename` / `notes.delete`：slug 生成与冲突追加序号；删除移到 `库/.trash/<timestamp>-<name>.md`。
- [ ] `notes.search`：标题 + 正文扫描（大小写不敏感，返回命中行片段），限 200 条；大库限流。
- [ ] `config.get` / `config.set`：`notes.vaultPath` 校验与生效逻辑，切换时返回新旧库路径供 UI 提示。

## 2. 块模型（核心）

- [ ] `parseMarkdown(text) → Block[]`：用 markdown-it AST 映射为块（heading / paragraph / todo / quote / code / divider / raw）。
- [ ] `serializeBlocks(blocks) → text`：自写 renderer，保持 frontmatter 顺序与未知字段。
- [ ] **兜底**：表格、脚注、HTML、图片段落等不支持的节点整体收成 `raw` 块 —— 只读展示原始 Markdown，保存时原样写回，保证不丢内容。
- [ ] 单元测试：往返一致性（parse → serialize 后与原文语义等价），覆盖标题/待办/引用/代码/表格/嵌套列表。

## 3. 客户端笔记 UI

- [ ] 注册 `ternTabs` 类型 `note`（`contentId: 'note:<relPath>'`，order 50）。
- [ ] 注册 `ternTabs` 类型 `notes`（笔记列表页：搜索框 + 排序 + 新建 + 列表项），`+` 菜单直达。
- [ ] Notion 编辑器：大标题（32px）+ 标签行 + 块序列；块内编辑用 contentEditable 或 textarea 逐块实现（不引富文本框架）。
- [ ] 行首快捷：`# ` / `- ` / `> ` / ` ``` ` 转块；回车新建段落；待办可勾选；代码块语言可切。
- [ ] 块手柄：hover 显示 `⋮⋮`，点击弹块菜单（删除 / 转类型 / 复制）。
- [ ] 保存：800ms debounce + `Ctrl+S`；状态指示（未保存/保存中/已保存/冲突）。
- [ ] 冲突处理：`notes/conflict` → 弹层「外部已修改」选择重载 / 覆盖 / 另存副本。
- [ ] frontmatter：新建写 `title/created/updated`；保存只更新 `updated`，保留未知字段与顺序。
- [ ] 关闭确认：`dirty` 的笔记 tab 关闭前弹确认。

## 4. 设置项

- [ ] 配置页「外观与字体」页末尾或独立「笔记」分组：笔记库目录输入 + 目录选择器（复用宿主 directory-picker）；显示当前路径与「打开目录」（宿主 open-in-app）。

## 5. 验证

```powershell
pnpm build
dsh plugin --profile desktop add C:\projects\dsh-workspace\dsh-tern-workspace
```

- [ ] 首次进入自动建库；新建 → 编辑 → 自动保存 → 刷新后内容与标题一致。
- [ ] 行首 `# ` / `- ` / ` ``` ` 转块生效；待办勾选后重开保持。
- [ ] 打开一个含表格与未知 frontmatter 的 Obsidian 笔记：表格以原始块展示，保存后内容与字段不丢。
- [ ] 外部编辑器改同一文件 → 提示冲突 → 重载/覆盖两条分支行为符合 PRD。
- [ ] 改库目录到另一个目录：列表正确切换，旧库文件未被改动。
- [ ] 删除 → 进 `.trash` → 手动恢复后重新出现。
- [ ] 库不可写时 UI 显示可读错误并可重试，不崩面板。
- [ ] 跨工作区：A 工作区建的笔记在 B 工作区可见。
- [ ] 回滚点：宿主服务 / 块模型 / 客户端 UI 分三次提交。
