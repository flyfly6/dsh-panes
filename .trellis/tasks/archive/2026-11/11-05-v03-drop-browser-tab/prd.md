# v0.3-F 移除浏览器 tab（webview 不可用）

父任务：`11-05-v03-iteration`（v0.3 迭代，F 组）。

## Goal

用户反馈"浏览器 tab 很多页面打不开"。调研结论是普通插件拿不到 Electron `<webview>`，iframe 已是上限——于是移除该 tab 类型，把"在系统浏览器打开"留给外部。

## 调研结论（证据见父任务 `research/browser-webview.md`）

- 桌面主窗口 `webviewTag: primary`，但宿主在应用文档创建 webview 之前注册了 `will-attach-webview`，只放行自己预发的 `about:blank#<lease>` guest；插件自建的 webview 被 `preventDefault`。
- 参考插件 `dsh-browser` 靠往桌面安装目录装 bridge（改宿主）才能驱动宿主侧栏的浏览器，Web 端则自带 Electron 二进制——两条都不符合本插件"不改宿主"的底线。
- 剩下的 iframe 无法绕开站点的 `X-Frame-Options` / `frame-ancestors`。

## Requirements

1. 新建 tab 下拉菜单去掉「浏览器」。
2. 删除 `BrowserView` 组件、`browser` 图标条目与全部 `browser.*` / `tab.browser` 文案。
3. `BUILTIN_KINDS` 去掉 `browser`；`parseLayout` 遇到旧的 `browser` tab 直接丢弃（其余 tab 照常恢复，不报错）。

## Acceptance Criteria

- [x] 新建菜单不再出现「浏览器」。
- [x] 含 browser tab 的旧 localStorage 布局能正常加载，只是少了那个 tab（`test/tabs.test.mjs` 覆盖）。
- [x] `grep -rn "browser\." src` 只剩注释与宿主半边说明，无 UI 文案引用。
- [x] `pnpm typecheck` / `pnpm test` 通过。

## Non-goals

- 不做"在系统浏览器打开当前地址"的新入口（没有浏览器 tab 就没有地址栏；外部链接仍按宿主默认行为处理）。
- 不引入第三方浏览器插件依赖。
