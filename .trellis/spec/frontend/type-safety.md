# Type Safety

> One `tsconfig.json`, `strict: true`, `tsc --noEmit` as the gate. No validation
> library, no generated types, no `zod`. Types are hand-written and the boundary is
> normalized by hand.

---

## Overview

```jsonc
// tsconfig.json
{
  "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
  "jsx": "react-jsx", "strict": true,
  "noUncheckedIndexedAccess": false,   // index reads are `T`, not `T | undefined`
  "isolatedModules": true, "noEmit": true, "skipLibCheck": true,
  "include": ["src", "tsdown.config.ts"]
}
```

Implications to write code by:

- `strict` is on: no implicit `any`, `null` is checked, `override` is required on
  class members (`Guarded` writes `override state`, `override render()`).
- `noUncheckedIndexedAccess` is **off**, so array/module index reads type as `T`.
  The code still guards the cases that matter (`tabs[index]!` only after an index
  check, `entries[0]?.contentRect.width ?? 0`), but a missing `!` is not a type error
  — so the guard is a review responsibility, not a compiler one.
- `isolatedModules` means `import type` is mandatory for type-only imports from a
  module that also has a runtime export.

---

## Type Organization

| Where | What lives there |
|---|---|
| `src/panel/types.ts` | The host surface: `PanelProps`, `Remote`, `FileText`, `DirectoryListing`, `Project`, `Translate` |
| `src/tabs.ts` | The data model: `Layout`, `ProjectTabs`, `TabModel`, `TabKind`, `OpenTabInput` |
| `src/api.ts` | The wire: `NameHit`, `ContentHit`, `SearchResult<T>`, `ApiCallError` |
| `src/search.ts`, `src/notes.ts` | Host-side request/response shapes (`SearchRequest`, `SearchReport`, `NoteMeta`, `NoteEntry`) |
| `src/git/*.d.ts` | Hand-written types for the two vendored `.js` files — typecheck never enters them |
| `src/types/*.d.ts` | Ambient declarations for untyped deps (`markdown-it-task-lists`, `schemastery`) |
| The component file | Local `Props` and local state unions — not exported unless reused |

Rule: **a type lives next to its producer.** A shape that crosses the route goes in
`src/api.ts`; a shape that crosses a component boundary goes in `types.ts` or the
component.

---

## Validation

There is no schema validator on the client. Boundaries are normalized with explicit
code, and that code is the only place a raw payload is touched:

- **Host payload → typed object:** `projectsOf(items)` maps `workspaceId ?? id ??
  path`, coerces `sessionIds` to strings, derives `running`. Downstream code sees
  `Project[]` only.
- **Host response → typed object:** `gitSummaryOf` reads `body.ok === true` and
  builds `GitSummary` field by field with `typeof`/`Number(...)` coercion.
- **Persisted JSON → typed state:** `parseLayout` / `parseTab` (`src/tabs.ts`) drop
  anything unrecognizable and return `emptyLayout()` on a version or JSON mismatch.
- **Row config:** typed as `Record<string, unknown>` and read through the volatile
  ref with a `value()` helper; `fontStack` / `size` whitelist what may reach CSS.

A new persisted or wire shape must arrive with a parser of this kind. `JSON.parse`
output is never cast and used.

---

## Common Patterns

- **Discriminated unions for state machines:**
  `type State = { status: 'loading' } | { status: 'ready'; text: string; count: number; eof: boolean; loadingMore: boolean } | { status: 'error'; message: string }`
  (`FileView`) — the render switches on `state.status` and the compiler checks the
  fields.
- **Result objects for host services:**
  `{ ok: true; value: FileText } | { ok: false; error: { code: string; message: string } }`.
- **`as const` for literal tables**, then derive:
  `BUILTIN_KINDS`, `SCHEMA_VERSION = 2 as const`, `SIDEBAR_WIDTH`, `THEMES`.
- **`TabKind = string` on purpose.** A third-party plugin can register a kind
  without editing this repo; the registry is the source of truth for what exists,
  the model only stores what was opened.
- **`Translate = (key: string) => string`** — the dictionary is a flat
  `Record<string, string>`; a typo costs a missing label, not a type error, which is
  why every key must exist in both `zh` and `en`.
- **Generics where the caller decides the payload:** `call<T>(op, args, signal)`
  returns `Promise<T>`; `SearchResult<T>` in `src/api.ts`.
- **`catch` values are `unknown`/`Error`, then narrowed:** `failure.name ===
  'AbortError'`, `error instanceof Error ? error.message : String(error)`.

---

## Forbidden Patterns

| Forbidden | Why / instead |
|---|---|
| `any` on data that reaches app state | Normalize at the boundary (`projectsOf`, `gitSummaryOf`, `parseLayout`) |
| `as SomeType` on a `JSON.parse` result | Parse field by field |
| A second, parallel type for the same wire shape | Reuse `src/api.ts`; if it differs, the difference is a bug |
| `enum` | `as const` array + union, as `BUILTIN_KINDS` does |
| `!` on an index without a preceding bounds check | Guard, then assert; the compiler will not catch this for you |
| Editing a generated or vendored `.js` to satisfy types | Write a `.d.ts` (`src/git/panel.d.ts`), or fix the source properly |
| Type-only import written as a value import | `import type { … }` — `isolatedModules` is on |

`any` is allowed only at the **host boundary**: `ctx`, `req`/`res` in
`src/index.ts`, and the `useSession`-style host selectors in
`src/panel/ConversationSlot.tsx`. It must not survive past the function that
receives it.
