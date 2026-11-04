# v0.3-A 设置与外观：字号、明暗切换、tab 计数

父任务：`11-05-v03-iteration`（v0.3 迭代）。本子任务只做 A 组三项。

## Goal

工作台的字号能调、默认不再偏小；状态栏的明暗标识真的能点；状态栏那个数字改成用户能理解的东西（本项目已打开的 tab 数）。

## 已确认事实

- 字号**已有配置项且已生效**：`src/config.ts` 的 `fontUiSize`（0 = 跟随默认）+ `client.tsx` 的 `appearanceOf()` + `WorkbenchPanel.tsx` 的 `rootStyle` 把 `--wb-font-ui-size` 写到面板根。缺的是"整体字号都跟着变"——组件字号写死在 `tailwind.config.cjs` 的 `fontSize`（10/11/12/13px）和 25 处 `text-[10px]/text-[11px]` 里，改根字号只影响没写 class 的文本。
- 明暗来自 `useDark()`（监听 `body[data-ds-dark-theme]`），状态栏只渲染图标 + 文案（`WorkbenchPanel.tsx:945-947`），没有点击行为。
- 宿主客户端有主题服务：`ctx.theme.getTheme()` 返回 `{ preference, active: { id, colorScheme }, ... }`，`ctx.theme.setTheme(id)` 是唯一偏好写入口（内置 `light` / `dark` / `system`）。所以点击切换不需要自造持久化。
- 状态栏计数现在是 `project.sessionIds.length`（会话条数），文案 key `status.running`。

## Requirements

1. **字号整体可调 + 默认放大一档**：`tailwind.config.cjs` 的四档字号改为读 CSS 变量，变量由 `--wb-font-ui-size` 派生；默认根字号 12px → 13px（`2xs/xs/sm/base` 随之各 +1px，行高按现有 14/16/18/20 的偏差同步）。用户把 `fontUiSize` 改成 14/15 时，整块 UI 同比放大，而不是只有正文。
2. **把写死的 `text-[10px]` / `text-[11px]` 收进同一套档位**（改成 `text-2xs` / `text-xs`），避免放大后出现"大标题 + 小标签"的错位。没有对应档位的（`11.5px`）保留原样。
3. **状态栏明暗可点**：整块（图标 + 文案）变成按钮，点击在 `light` / `dark` 之间切换；当前是 `system` 时按当前解析结果切到相反的一侧。服务缺失时退化为不可点（保留原样文本，不报错）。
4. **状态栏计数 = 本项目已打开 tab 数**：显示 `N tabs`，随开/关实时变化；为 0 时不显示。

## Acceptance Criteria

- [ ] 默认打开工作台，正文/列表/按钮文字比 0.1.1 大一档，标签与正文的比例不变（没有"标签还是 10px"的错位）。
- [ ] 把 `fontUiSize` 设为 15 后（配置项已存在），tab 条、侧栏、状态栏文字一起变大；设为 0 回到新默认。
- [ ] 点状态栏的明暗文字，界面立刻切换浅色/深色并保持（重启后仍是该偏好）；宿主没有 theme 服务时点击无副作用、不抛错。
- [ ] 状态栏数字等于当前项目的 tab 条数：开一个 tab +1，关一个 -1，切项目显示新项目的数量。
- [ ] 新增文案进 `src/locale.ts`（zh/en）；`pnpm typecheck`、`pnpm test` 通过；`git diff` 不触碰 `lib/`（构建产物）。

## Non-goals

- 不做主题编辑器、不做自定义配色。
- 不改宿主主题实现，不复刻宿主设置页；字号仍走插件自己的 row config。
- 不动 `--wb-font-code-size` 的默认值（只让 `fontCodeSize` 继续可用）。

## 验证方式

- `pnpm typecheck` + `pnpm test`（`test/*.test.mjs`）。
- 手工：`grep -c 'text-\[10px\]' src` 应为 0；`grep -n 'wb-text-2xs' src/styles/tailwind.css` 有定义；状态栏点击后 `body[data-ds-dark-theme]` 属性翻转。
