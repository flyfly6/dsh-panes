# Component Guidelines

> React 18 function components, shadcn primitives, Tailwind tokens, one locale
> dictionary. Everything renders inside someone else's page, so nothing leaks out.

---

## Overview

- **Function components only.** The single class component is `Guarded`, an error
  boundary (React has no hook form) — the `ponytail:` comment in the file says so.
- **Server components, Suspense-by-default, memo wrappers, `forwardRef` all over:
  none of these.** The only `forwardRef` is in `src/ui/button.tsx`, where a shadcn
  primitive needs it. The only `lazy` is the BlockNote editor (`NoteEditorLazy` in
  `src/client.tsx`).
- **`import * as React from 'react'`** at the top of every component file. The
  browser bundle is CJS inside a `factory(require)` wrapper, so named ESM imports
  from a shared-table module are avoided on purpose; keep the namespace import.

---

## Component Structure

Order inside a file:

1. `import * as React from 'react'`, then third-party, then local (`../ui/…`,
   `./types`) — the existing files are not alphabetized; keep the visual grouping.
2. Small local helpers above the component if they are pure and file-private
   (`Marked` in `SearchView.tsx`, `columnAt` in `FileView.tsx`).
3. `interface Props` — not exported unless another file consumes it.
4. Local state types when the state is a union (`type State = { status: 'loading' } |
   { status: 'ready'; … } | { status: 'error'; message: string }` in `FileView.tsx`).
5. The component: hooks in a stable order (state → refs → effects → callbacks →
   handlers), then the early returns for `loading` / `error`, then the render.
6. Named export at the end (or `export function` inline). Default exports only for
   `React.lazy` targets.

---

## Props Conventions

- **Props are the view's whole input.** No component reads the workspace root, the
  active tab or a global store directly for *data* it draws — the shell passes
  `root` / `project` / `sessionId` / `remote` down.
- **The translator is always passed as `t: Translate`** (`src/panel/types.ts`), never
  imported as a module singleton, so a registered tab kind from another plugin gets
  the panel's dictionary.
- **Callbacks are named for the effect:** `onOpen(path, line)`, `onCursor(cursor)`,
  `openFile(path, line?, name?)`. A child does not mutate the layout itself.
- **Optional props mean "the host may not have it"** (`sessionId?: string`,
  `remote?: Remote`), and the component then renders a refusal instead of
  dereferencing (`FileView` reports `t('file.failed')` when `sessionId` is missing).
- **A `stamp?: number` / `token` counter is the idiom for "run it again"** (reveal
  the same line again, reload the same file). Do not resize an object to force it.

---

## Styling Patterns

- **Tailwind utilities with the theme tokens only.** `bg-card`, `text-muted-foreground`,
  `border-border`, `h-status`, `text-2xs` — all defined in `tailwind.config.cjs`
  against the host's CSS variables.
- **Text sizes are one ladder, and the ladder is variable-driven** (v0.3): the four
  steps `2xs / xs / sm / base` are `calc()`-derived from `--wb-font-ui-size` in
  `src/styles/tailwind.css`, and the row config's `fontUiSize` overrides that root
  variable. Use a step, never `text-[13px]` — an arbitrary px size opts the node out
  of the user's font-size setting.
- **Preflight is off** and every component renders under `.workbench-root` /
  `.workbench-portal`, so the panel cannot restyle the host. Do not add global
  selectors, `body {…}`, or unprefixed element styles to `src/styles/tailwind.css`.
- **`cn()` for conditional classes** (`src/ui/cn.ts`: clsx + tailwind-merge). Never
  build class strings with template literals and a ternary chain.
- **Variants belong in `cva`**, as in `src/ui/button.tsx`. Reuse `Button` instead of
  inventing a new clickable div; icon-only buttons pass `size="icon"` and a `title`.
- **`wb-*` classes for what Tailwind cannot do**: rendered shiki markup, hover/active
  line states, scrollbars. They live in `src/styles/tailwind.css`, not inline.
- **Never inject styles from a component.** The bundle installs its one `<style
  data-plugin-css>` element at `apply()` time (`installStyles` in `src/client.tsx`).
- Icons come from `lucide-react`; the sidebar glyph is hand-written SVG
  (`PanelIcon` in `src/client.tsx`).

---

## Accessibility

- **Decorative icons get `aria-hidden`**; icon-only buttons get a `title` (and
  `aria-label` when the title is not enough). See `FileView`'s wrap/reload buttons.
- **Every string goes through `t('key')`**, with the key present in both `zh` and
  `en` in `src/locale.ts`. A hardcoded English string is a review rejection.
- **Keyboard is part of the feature.** Global panel shortcuts are attached in one
  `keydown` listener with cleanup (`WorkbenchPanel`, `FileView`), and they ignore
  events when a focused editor or terminal owns the key.
- **Keep focus behaviour honest:** use real `<button>` (via `Button`), real `<input>`
  (via `Input`), and let `DropdownMenu` own its focus trap. No `role="button"` on a
  div.
- **Loading and error states are visible and labelled**, not blank space
  (`t('file.loading')`, `t('panel.noBridge')`).

---

## Common Mistakes

- **Importing a shared-table package as a named ESM import** (`import { X } from
  'react'`). It can break the CJS factory wrapper; use the namespace import.
- **Bundling something the host already provides** — `react`, `react-dom`,
  `react/jsx-runtime`, `@deepseek-ai/*` stay external (`tsdown.config.ts`). A second
  React copy throws on first render.
- **Adding a dependency to `dependencies` for a UI need.** The bundle is already
  ~9 MB; check `node_modules` and the stdlib first.
- **Tailwind classes that rely on preflight** (bare `h1`, `ul`, `button` resets) —
  they do not apply inside the panel.
- **A `guarded` boundary per component.** One per embedded host surface
  (`ConversationSlot`, terminal); the shell is not wrapped in it.
- **Reading layout from localStorage in a component.** Only `WorkbenchPanel` reads
  and writes the layout, through `src/tabs.ts`.
