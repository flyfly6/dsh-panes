# v0.3-G 品牌与发布物料

父任务：`11-05-v03-iteration`（v0.3 迭代，G 组）。

## Goal

让插件在市场卡片上有图标、README 描述与当前能力一致，并给出可发布的 0.2.0 版本号。

## Requirements

- [x] 图标：`assets/icon.svg`（矢量）+ `assets/icon.png`（512）+ `assets/icon-256.png`；`package.json` 增加 `icon` 字段指向 PNG。
- [x] README：顶部放图标；新增 `What's new in 0.2.0` 段落；删掉 browser tab 的所有描述与 Tabs 表格行；把"浏览器 tab 只能嵌允许嵌入的站点"替换为"没有内嵌浏览器"的说明。
- [x] `package.json`：版本 0.1.1 → 0.2.0，description 去掉 browser，keywords 增加 notes。
- [x] 截图清单 `screenshots.json` 保持既有六张（0.2.0 的实际界面变化需要重新截图，见下）。

## Acceptance Criteria

- [x] `assets/icon.png` 能在市场卡片显示（512×512，透明圆角，蓝色底 + 侧栏 + tab 卡）。
- [x] README 不再出现 `browser` tab，版本号与 package.json 一致（0.2.0）。
- [x] `node -e "require('./package.json').version"` 输出 0.2.0。

## 未完成 / 需要用户处理

- **重新截图**：`assets/01-workspace.png` … `06-appearance-settings.png` 是 0.1.1 的界面（含 browser tab、旧字号）。当前会话只能读 Web GUI 的 HTTP 页面（且该页在无宿主引导时是空壳），拿不到真实运行截图，需要用户在桌面端截 3–6 张替换。
- **`npm publish` 与市场上架**：需要本机 npm 凭证与市场发布权限，本轮不执行（`prepublishOnly` 会跑 `pnpm build`）。
