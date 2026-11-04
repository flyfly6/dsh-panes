# 浏览器 tab：webview 可行性调研（2026-11-05）

问题：能否用 Electron `<webview>` 替换 `BrowserView.tsx` 里的 iframe，救活"很多页面打不开"的问题。

## 结论

**普通插件做不到，建议移除浏览器 tab。**

## 证据链

1. **桌面主窗口确实开了 webview 标签**：`app.asar` 的 BrowserWindow 配置里 `webPreferences.webviewTag: primary`（其它窗口为 `false`），所以 `<webview>` 元素在渲染进程里"看起来"能用。
2. **但主窗口装了附件闸门**：宿主在应用文档创建 webview 之前就注册了 `will-attach-webview`，且只放行自己预发租约的 guest：

   ```js
   owner.on("will-attach-webview", (event, preferences, params) => {
     const id = params.src.startsWith("about:blank#") ? params.src.slice(12) : ""
     const lease = this.leases.get(id)
     if (lease === void 0 || lease.owner !== owner || lease.attached || params.partition !== lease.partition) {
       event.preventDefault(); return
     }
     ...
   })
   ```

   插件自己 `document.createElement('webview')` 后挂上去的 src 不可能是 `about:blank#<内部租约 id>`，`lease === undefined` → 直接 `preventDefault`，webview 永远不会 attach。
3. **另一个窗口的 handler 更彻底**：另一处 `will-attach-webview` 无条件 `event.preventDefault()`。
4. **参考插件 dsh-browser 也不是"普通插件"**：`wqty123/dsh-browser` 驱动宿主侧栏浏览器靠的是 `desktop-bridge/install.mjs` —— 往桌面端安装目录里装一条 bridge（且桌面端升级后 bridge 会 `stale`）。Web 端则用自托管窗口 + 自带 Electron 二进制。两条路都不是本插件该走的（R1：不改宿主）。
5. **Web GUI 端根本没有 webview**：`dsh web` 跑在普通浏览器里，`<webview>` 不存在，只能 iframe。

## 因此

- `browser` tab 的 iframe 已经是客户端插件能做到的上限；"打不开"的站点是 `X-Frame-Options` / `frame-ancestors` 拒绝被框，不是实现缺陷。
- 决定移除该 tab 类型：新建菜单不再出现 `browser`，启动恢复遇到旧 `browser` tab 静默丢弃并提示一句；地址栏入口改为"在系统浏览器打开"。

## 复现方式（供后人复核）

```bash
strings -a "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar" > /tmp/asar-strings.txt
grep -n "will-attach-webview" /tmp/asar-strings.txt   # 3501313 / 3501576 / 3501626
grep -n "webviewTag" /tmp/asar-strings.txt            # 3501277 false / 3501593 false / 3502718 primary
```
