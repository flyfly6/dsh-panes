# Hook Guidelines

> Plain React hooks. No data-fetching library, no state library, no context
> providers. A module with a `subscribe()` function and a thin `useX()` wrapper is
> the extension point.

---

## Overview

| Need | What this repo does |
|---|---|
| Fetch from the host route | `call()` from `src/api.ts` inside an effect/callback, with an `AbortController` |
| Fetch workspace files | `remote.workspaceFiles.read/list/readBytes` (host service passed as a prop) |
| Shared out-of-React state | module `Map` + listener `Set` + `subscribeX()` + `useX()` (`src/git/status.ts`) |
| Derived data | `React.useMemo` for arrays/objects, plain expression for scalars |
| Heavy module | `React.lazy` behind a `Suspense` with a translated fallback (`NoteEditorLazy`) |
| Theme | `useDark()` — local to `WorkbenchPanel.tsx`, watches `data-ds-dark-theme` / `class` / `style` |

`useWorkspaces` is **not ours**: the host hands it in as a prop (`PanelProps`), with
a selector — `useWorkspaces((snapshot) => snapshot.items)` — so only a changed slice
re-renders.

---

## Custom Hook Patterns

1. **Module store first, hook second.** Keep the state outside React
   (`src/notes/store.ts`, `src/git/status.ts`), expose `subscribeX(listener)` returning
   an unsubscribe, then wrap it:

   ```ts
   export function useGitSummary(cwd: string | undefined): GitSummary | null {
     const [value, setValue] = useState<GitSummary | null>(() => gitSummaryOf(cwd))
     useEffect(() => {
       setValue(gitSummaryOf(cwd))
       const off = subscribeGitSummary(() => setValue(gitSummaryOf(cwd)))
       refreshGitSummary(cwd)
       const timer = setInterval(() => refreshGitSummary(cwd), TTL)
       return () => { off(); clearInterval(timer) }
     }, [cwd])
     return value
   }
   ```

   One subscription per concern, one cleanup, and the hook stays a binding — no
   business logic, so it needs no test.
2. **Ad-hoc subscription inside an effect** is fine for one consumer:
   `subscribeNoteStatus(() => setNoteState(noteStatusOf(...)))` in
   `WorkbenchPanel.tsx`.
3. **Hooks that need the panel dictionary take `t` as an argument**, never import it.
4. Do not introduce `useSyncExternalStore`, `Context`, or a query cache. The current
   pattern is `useState` + `subscribe`; migrate only when tearing is actually
   observed, and do it in one place first.

---

## Data Fetching

- **Async work lives in `useEffect` or `useCallback`, never in render.**
- **Cancel by flag or abort.** A `live = true` in the effect, set to `false` in the
  cleanup, guards every `setState` (`FileView`). A superseding request aborts the
  previous one via a ref (`abort.current?.abort()` in `SearchView`).
- **`AbortError` is not an error.** `.catch((failure) => { if (failure.name ===
  'AbortError') return; … })`.
- **Host refusals are values, not exceptions, on the `remote` surface:**
  `{ ok: true, value } | { ok: false, error: { code, message } }` — branch on
  `result.ok`, map the code to a translated message. The plugin route throws
  instead; use `call()` and catch `ApiCallError`.
- **Re-run on demand with a counter, not a mutated payload**: `stamp` in tab params
  (reveal the same search line again), `token` state (reload a file).
- **Debounce in a ref, not in state:** `debounce.current = window.setTimeout(...)`
  in `changeQuery`, cleared on the next keystroke.

---

## Naming Conventions

| Thing | Convention | Examples |
|---|---|---|
| Custom hook | `use` + PascalCase noun | `useGitSummary`, `useDark` |
| Boolean state | adjective / `is`-less positive | `narrow`, `busy`, `wrap`, `dark` |
| Effect helper | verb | `load`, `run`, `refreshGitSummary`, `reveal` |
| Ref holder | noun describing the value | `abort`, `debounce`, `lineNodes`, `hovered`, `dragIndex` |
| Setter for a list | verb | `setLayout`, `setResult`, `setPreview` |

Hooks inside one component are ordered state → refs → effects → callbacks, so a
reader can scan the data flow top to bottom (`FileView.tsx`, `SearchView.tsx`).

---

## Common Mistakes

- **`useCallback` on every function.** Use it when the function is a dependency of an
  effect/memo or is passed to a registered/embedded host surface; otherwise leave a
  plain function (`reportCursor`, `changeQuery` are plain).
- **Missing cleanup** on `addEventListener`, `setInterval`, `setTimeout`,
  `ResizeObserver`, `MutationObserver`. Every one of them appears with a disposer in
  this repo — match that.
- **Writing state after unmount** because the fetch had no `live` flag.
- **An honest-looking dependency array that is not honest.** `SearchView` keeps one
  `// eslint-disable-next-line react-hooks/exhaustive-deps` for "first hit of a new
  result set"; there is no ESLint in this repo, so the comment exists only as a
  marker — copy it only when the omission is deliberate, and say why in a line above.
- **Recomputing `projectsOf(items)` / grouped search hits inline in JSX** instead of
  `useMemo` — both build new arrays every render and are used as deps elsewhere.
- **A hook that reads `window.localStorage`.** Layout persistence is the panel
  shell's job, through `src/tabs.ts`.
