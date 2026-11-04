# Quality Guidelines

> The gate: `tsc --noEmit` + a single-file bundle that actually wraps. There is no
> ESLint or Prettier config in this repo — do not assume formatting is enforced by
> tooling; match the surrounding file.

---

## Overview

| Command | Checks |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` over `src/` including `.tsx` |
| `pnpm build` | `build:styles` → Tailwind CSS into `src/generated/styles.ts`; `tsdown` → `lib/index.js`, `lib/client.bundle.js`; `wrap-client.mjs` → `lib/client.js` |
| `pnpm test` | `node --test test/*.test.mjs` — no DOM, so it covers models and the host route, not views |
| `pnpm check` | all three |

A client change is verified by **rebuilding and reloading the panel in a profile**
(`pnpm build`, then read the page again; a bundle added to a profile needs a client
restart). There is no dev server and no HMR in this flow.

---

## Forbidden Patterns

| Forbidden | Why / instead |
|---|---|
| A `.css` import from a component | The bundle is JS-only: `build:styles.mjs` generates `src/generated/styles.ts`; import that module (as `src/client.tsx` does) |
| Editing `src/generated/styles.ts` | Regenerated on every build; gitignored |
| Installing styles from a component (`<style>`, `style=` blocks, injected `<link>`) | One `<style data-plugin-css>` element is installed once in `apply()` |
| Global/unscoped CSS selectors (`body`, bare `button`) | Preflight is off and the panel must not deform the host; scope under `.workbench-root` / `.workbench-portal` |
| A user-visible string that skips `t()` | Untranslated UI in a bilingual panel; add the key to **both** `zh` and `en` |
| A new heavy dependency | The bundle is ~9 MB already (BlockNote dominates); check `node_modules` first, and lazy-load anything large |
| Bundling `react` / `react-dom` / `@deepseek-ai/*` | They must stay external (`tsdown.config.ts`); a second React throws on first render |
| Splitting the browser build into chunks | `inlineDynamicImports: true` — a split chunk would 404 at runtime |
| `dangerouslySetInnerHTML` on anything but sanitized/machine-generated HTML | Allowed today only for shiki output (`FileView`) and `DOMPurify`-sanitized Markdown (`src/markdown.ts`) |
| `console.log` left in a view | Delete before commit; the build does not strip it |
| A component that reaches into `ctx` directly | Everything the panel needs arrives as props; `ctx` is touched in `src/client.tsx` only |

---

## Required Patterns

- **`import * as React from 'react'`** in every component file (CJS factory wrapper).
- **Tailwind tokens only** — colors/radii/font sizes from `tailwind.config.cjs`
  (`bg-card`, `border-border`, `text-muted-foreground`, `text-2xs`, `h-status`).
  A raw hex color is a review rejection.
- **`cn()` for conditional classes**, `cva` for variants, `Button` / `Input` /
  `DropdownMenu` from `src/ui/` instead of new primitives.
- **One `<style>` element, one locale registration, one panel registration** — all
  from `apply()` in `src/client.tsx`, each wrapped in `ctx.effect` with its disposer.
- **Every effect cleans up**: timers, listeners, observers, in-flight promise `live`
  flags.
- **Loading / empty / error states are visible**, translated, and drawn with the same
  density as the rest (`FileView`, `SearchView`, `ExplorerView`).
- **Comments in English; deliberate short-cuts marked `ponytail:`** with the ceiling
  named.

---

## Testing Requirements

- **Pure logic is tested; views are not.** There is no jsdom setup and no component
  test framework — do not add one for a single case. `src/tabs.ts` carries the layout
  tests (`test/tabs.test.mjs`).
- **A view's non-trivial logic should be extractable** to a pure function so it can
  be tested. If it cannot be, that is a smell worth a second look before shipping.
- **The host route is covered end-to-end** (`test/host.test.mjs`) against the built
  bundle, so a broken build fails the suite.
- **Manual GUI smoke after touching the shell or a view:** open the panel, open one
  tab of the kind you changed, resize the panel to <820 px (rail collapse), switch
  project (tab sets swap), reload the page (layout restored).

---

## Code Review Checklist

- [ ] `import * as React from 'react'`, and no shared-table package imported as a
      value import?
- [ ] Every new string in `zh` **and** `en`, with the `tab.<kind>` / `<area>.<action>`
      key shape?
- [ ] Classes only from theme tokens, conditionals via `cn()`?
- [ ] New host interaction: through `call()` / a passed-in service, with the failure
      branch rendered?
- [ ] Effects, listeners, observers and timers disposed?
- [ ] No new dependency; nothing that should be external got bundled?
- [ ] Decorative icons `aria-hidden`, icon-only buttons carry `title`?
- [ ] Layout change went through `src/tabs.ts` (no in-place mutation, no second
      storage key)?
- [ ] `pnpm check` green, and the panel loaded once in a profile?
