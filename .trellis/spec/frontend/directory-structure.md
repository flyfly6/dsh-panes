# Directory Structure

> How the browser half of this package is organized.

---

## Overview

The browser half is one bundled file (`lib/client.js`) produced from
`src/client.tsx`. There is no router, no pages directory and no data layer: the
panel is a shell (`src/panel/WorkbenchPanel.tsx`) plus one view per tab kind.

`src/` holds **both halves**; the split is by entry, not by folder:

| Entry | Half |
|---|---|
| `src/index.ts`, `src/config.ts`, `src/search.ts`, `src/ripgrep.ts`, `src/notes.ts`, `src/git/host.js` | host (Node) |
| `src/client.tsx` and everything it imports | browser |

Rule of thumb: if a file imports `node:` or `fs`, it must never be imported from
`src/client.tsx` — the bundle has no Node builtins (see `scripts/wrap-client.mjs`
for the two shims it does provide).

---

## Directory Layout

```
src/
├── client.tsx          browser entry: cordis plugin (name/inject/apply), slot
│                       registrations, tab-type registry wiring, styles install
├── panel/
│   ├── WorkbenchPanel.tsx   shell: sidebar, tab strip, status bar, layout state,
│   │                        `createRegistry()` + `TabTypeSpec`
│   ├── types.ts             PanelProps / Remote / Project / Translate (host surface)
│   ├── FileView / ExplorerView / SearchView / MarkdownView / TerminalView /
│   │   BrowserView / QuickOpen / SessionCard / ConversationSlot / icons
│   └── Guarded.tsx          error boundary for one embedded host surface
├── notes/
│   ├── NotesList.tsx        vault list tab
│   ├── NoteEditor.tsx       BlockNote editor tab (loaded lazily)
│   └── store.ts             dirty/status module store
├── ui/                 shadcn primitives only: button, input, dropdown-menu, cn
├── git/                forked Git tool window (host.js, panel.js + .d.ts) and our
│                       adapter (tab.tsx, status.ts)
├── tabs.ts             pure tab model (no DOM, no storage, no host)
├── api.ts              POST {op,args} helper + wire types
├── locale.ts           zh/en dictionaries, NS = 'workbench'
├── highlight.ts        shiki highlighter (fixed language set) + isDark/languageOf
├── markdown.ts         markdown-it (html:false) + DOMPurify
├── styles/tailwind.css design tokens feeding tailwind.config.cjs
├── generated/          styles.ts — build output, gitignored
└── types/              ambient .d.ts for untyped deps and vendored js
```

---

## Module Organization

- **One view per tab kind, in `src/panel/`.** A view receives the data it draws
  (`root`, `sessionId`, `remote`, `t`, callbacks) and holds its own local state; it
  never reaches into the shell.
- **The shell owns layout, not content.** `WorkbenchPanel` resolves the active
  project/tab and renders the registered view; it does not know what a `file` tab
  does.
- **Tab kinds register themselves from `src/client.tsx`**, not from the view file:

  ```ts
  registry.register({ kind: 'git', order: 30, render: ({ project, sessionId }) => <GitTab … /> })
  ```

  `src/client.tsx` also exports the registry (`ctx.provide('workbenchTabs', …)`) so
  another plugin can add a kind. Its order lives next to its registration.
- **Adding a built-in tab kind** touches four places: the registry call in
  `src/client.tsx`, `BUILTIN_KINDS` in `src/tabs.ts` (only if the `+` menu builds
  it), the `tab.<kind>` label in **both** `zh` and `en` in `src/locale.ts`, and the
  view file in `src/panel/`.
- **Roots and paths come from props.** No component reads `window.location`,
  `process.env` or a global for the workspace root.

---

## Naming Conventions

| Thing | Convention | Examples |
|---|---|---|
| Component files/export | PascalCase, named export | `FileView.tsx` → `FileView` |
| Non-component modules | lowercase | `tabs.ts`, `api.ts`, `locale.ts` |
| Props interfaces | `Props`, or `<Name>Props` when exported/reused | `interface Props`, `TabRenderProps` |
| Tab kinds | lowercase, singular | `session`, `file`, `explorer`, `note`, `notes` |
| Locale keys | `<area>.<camelCaseAction>` | `file.loadMore`, `tabs.closeAll`, `notes.status.saving` |
| CSS hooks | `wb-` prefix where Tailwind cannot express it | `wb-shiki`, `wb-line-hover`, `wb-scroll` |
| localStorage | `dsh-panes:<what>` | `dsh-panes:layout` |

---

## Examples

- **Shell + registry:** `src/panel/WorkbenchPanel.tsx` (`createRegistry`,
  `TabTypeSpec`, `TabRenderProps`) and its use in `src/client.tsx`.
- **View with its own data lifecycle:** `src/panel/FileView.tsx` — paged reads,
  abort-by-`live` flag, shiki highlighting, status bar line/column reporting.
- **View that calls the host route directly:** `src/panel/SearchView.tsx` — `call()`
  from `src/api.ts` with an `AbortController`, debounce, grouped results.
- **Primitive layer:** `src/ui/button.tsx` (cva variants) and `src/ui/cn.ts`.
