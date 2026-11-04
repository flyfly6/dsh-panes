# 会话 tab 与默认界面的会话关系（2026-11-05）

回答评审问题："新建会话 tab 会同步出现在默认页面的工作区会话列表里吗？两处是同一份还是两份？同时打开会冲突吗？"

## 现状（为什么"新建会话 tab 会加载上一个历史会话"）

`src/panel/WorkbenchPanel.tsx:399-403`：

```ts
if (kind === 'session') {
  const sessionId = project?.sessionIds[0]
  if (sessionId === undefined) return
  open({ kind: 'session', contentId: sessionId, title: t('tab.session') })
}
```

会话 tab 拿的是**项目里第一个已有会话**，既不新建也不询问，所以永远显示"上一个会话"。这是实现取巧，不是宿主限制。

## 宿主能力（Inspect 实测契约）

| 侧 | 服务 | 相关方法 |
|---|---|---|
| 客户端 | `ctx.sessions` | `retain(target, opts)` / `using` / `retainInfo(id)` / `search` / `fork` / `scope` / `binding` —— **没有 create** |
| 宿主 | `ctx.sessions` | `create(id?, options?)`、`prepare`、`fork`、`get`、`list` |
| 宿主 | `ctx.agents` / `ctx.agentLoop` | `create(options)` / `create(id, options, meta)` |
| 宿主 | `ctx.workspaceRegistry` | `list()` 返回的 `Workspace` 带 `sessionIds`、`attachSession(id)`、`insertSessionBefore`、`detachSession` |

## 结论

1. **会话是宿主侧的唯一对象**，不是一个 tab 一份。默认页面和插件 tab 里显示的是同一个 session id、同一份事件日志。
2. **要出现在默认页面的工作区会话列表里，必须 `attachSession`**：列表来自 `workspaceRegistry` 的 `sessionIds`（按 canonical cwd 索引过滤）。只建 session 不 attach，就只在 tab 里可见，默认界面找不到。
3. **不会冲突**：客户端 `retain` 是引用计数的（`SessionRetainInfo.referenceCount` / `retainedBy`），多消费者并存是设计内行为——默认页面与工作台 tab 各自持有一份引用，各自独立渲染同一份日志；任意一方的输入都会出现在另一方。
4. 因此推荐实现：**宿主半边建会话（`agents.create` 或 `sessions.create`）→ `workspace.attachSession(id)` → 客户端 `retain(id)` 打开 tab**。这样"不额外多建一个会话"，只是同一个新会话出现在两个地方。需要先在实施阶段跑一次 spike 确认 `agents.create` 的必填项（preset/模型/cwd）与默认界面的新建路径一致。

## 风险

- 两个视图同时存在时，用户在默认页面看到的是同一个会话，可能误以为"会话被抢走了"——UI 文案要说明这是同一个会话。
- 同一 session 若被打开成两个 tab，应做内容去重（`contentId` 相同即聚焦已有 tab，不新增）。
