# v0.3-A 自查记录

日期：2026-11-05　轨道：feat　范围：字号变量化 / 状态栏明暗切换 / 状态栏 tab 计数

## 改动文件

| 文件 | 改动 |
|---|---|
| `tailwind.config.cjs` | 四档字号与行高改为 `var(--wb-text-*)` / `var(--wb-lh-*)`，并注明由 `--wb-font-ui-size` 派生 |
| `src/styles/tailwind.css` | 默认 `--wb-font-ui-size` 12px → 13px；新增四档字号 + 行高变量（`calc()` 派生，保持 14/16/18/20 的行高节奏） |
| `src/panel/WorkbenchPanel.tsx` | 状态栏明暗改为 `<button>`（`props.toggleTheme`，无服务时 `disabled`）；计数由 `project.sessionIds.length` 改为 `state.tabs.length` |
| `src/client.tsx` | 新增 `toggleTheme()`：读 `ctx.theme.getTheme().active.colorScheme`，用 `setTheme()` 切到相反一侧；取不到服务时静默返回 |
| `src/panel/types.ts` | `PanelProps.toggleTheme?` |
| `src/locale.ts` | 新增 `status.tabs` / `status.themeToggle`（zh/en），删除已无引用的 `status.running` |
| `src/panel/{FileView,SearchView}.tsx`、`src/notes/NotesList.tsx` | `text-[10px]` → `text-2xs`、`text-[11px]` → `text-xs`（25 处，纯类名替换） |

## 检查矩阵

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm run typecheck` | 0 errors |
| 单元测试 | `pnpm run test` | 40 pass / 0 fail |
| 代码风格 | 仓库无 ESLint/Prettier 配置（见 `.trellis/spec/frontend/quality-guidelines.md`），按周围代码风格手写 | n/a |
| 规范门禁 | 前端 quality-guidelines：Tailwind token only、文案进 zh+en、组件不直接碰 `ctx`、样式只在 `apply()` 装一次 | 合规（`toggleTheme` 作为 prop 传入；颜色用 `bg-accent`；无新增 CSS 文件） |

## 逐条对照 PRD 验收

- [x] **默认放大一档**：根字号 12 → 13px，`2xs/xs/sm/base` 由 `calc()` 派生（11/12/13/14），行高同步 +1；比例与原来一致。
- [x] **整体可调**：`fontUiSize` 仍由 `rootStyle` 覆盖 `--wb-font-ui-size`，四档字号全部跟着变（生成产物已确认 `.text-xs{font-size:var(--wb-text-xs)…}`）。
- [x] **写死字号归位**：`grep -rc 'text-\[1[01]px\]' src` 无命中（仅剩一处 `text-[11.5px]`，不在档位上，按 PRD 保留）。
- [x] **明暗可点**：按钮点击走 `theme.setTheme`，宿主负责持久化；`system` 时按当前解析结果切相反一侧；服务缺失时 `disabled` 且无副作用。
- [x] **计数=tab 数**：`state.tabs` 就是当前项目（`projectState(layout, activeProjectId)`）的 tab 列表，开/关/切项目自然跟随；为 0 时不渲染。
- [x] **文案双语**：新增 key 同时进 `zh` / `en`。

## 未做 / 已知边界

- `text-[11.5px]` 保留原值（无对应档位，属故意不为一个点新增档）。
- 未新增自动化测试：改动是 CSS 变量派生 + 一个按钮回调 + 一个计数表达式，没有可断言的纯逻辑；spec 明确"views are not tested"。
- 实际像素效果需要在 profile 里 `pnpm build` 后重载面板才能肉眼确认（本轮未跑构建，按全局验证规则）。
