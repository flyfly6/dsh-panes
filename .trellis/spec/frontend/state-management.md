# State Management

> No Redux, no Zustand, no Jotai, no React Query, no context provider. There are
> four kinds of state and each has exactly one home.

---

## Overview

| Kind | Home | Written by |
|---|---|---|
| Panel layout (tabs, active tab, closed stack, sidebar) | `useState<Layout>` in `WorkbenchPanel` + `localStorage['dsh-panes:layout']` | pure functions in `src/tabs.ts` |
| View-local state (filter, pending query, expanded groups, wrap) | `React.useState` inside that view | the view |
| Cross-view ephemeral state (note dirty/status, git summary cache) | module stores: `src/notes/store.ts`, `src/git/status.ts` | the module's setters, after host calls |
| Host-owned state (workspaces, sessions, terminals, row config) | the host, read through `ctx.*` / a prop subscription | the host |

Plus one persisted preference outside the layout: `localStorage['dsh-panes:last-panel']`
(`rememberPanel` / `lastPanel` in `WorkbenchPanel.tsx`), used by `startup: 'last'`.

---

## State Categories

### Layout — the only "global" state

- One immutable `Layout` object: `{ schemaVersion, activeProjectId, projects }`,
  where each project holds `{ tabs, activeTabId, closed, sidebar }`.
- **Every mutation is a pure function in `src/tabs.ts`** returning a new object:
  `openTab`, `activateTab`, `closeTab`, `reopenLast`, `moveTab`, `renameTab`,
  `setSidebar`, `dropProject`, `ensureProject`, `setActiveProject`. The shell calls
  them through the updater form:

  ```ts
  setLayout((prev) => openTab(prev, activeProjectId, input))
  ```

  Nothing outside `src/tabs.ts` builds a `Layout` by hand.
- **Persistence is one effect**, not a call per mutation:

  ```ts
  React.useEffect(() => {
    try { window.localStorage.setItem(STORE_KEY, serializeLayout(layout)) }
    catch { /* private mode: keep the in-memory layout */ }
  }, [layout])
  ```

  Read once with `useState(readStored)`; `readStored` funnels through
  `parseLayout`, which never throws.
- **Identity is structural:** `tabId(projectId, kind, contentId)` →
  `` `${projectId}:${kind}:${contentId}` ``. That string is the React key and the
  dedupe key; opening the same file twice activates the existing tab and merges
  `params`.
- **Tabs are scoped to the project.** Switching project switches the whole set;
  `closed` is per project and capped at `CLOSED_LIMIT` (10).

### View-local state

Everything a single view needs to draw itself: `filter`, `quickOpen`, `cursor`,
`narrow` in the shell; `query`, `regex`, `result`, `busy`, `error`, `collapsed`,
`preview` in `SearchView`; `state`, `wrap`, `html`, `dark` in `FileView`. Keep it
there; do not lift it to the shell unless two views read it.

Union-typed state is the idiom for a view's lifecycle
(`FileView`'s `State = loading | ready | error`) — one `status` field instead of
three booleans that can disagree.

### Cross-view ephemeral state

Promote to a module store only when a non-parent needs it:

- `src/notes/store.ts` — `setNoteDirty` / `isNoteDirty`, `setNoteStatus` /
  `noteStatusOf` / `subscribeNoteStatus`. It exists because the tab model is plain
  data and must not know about editors; the shell reads it to refuse closing a dirty
  tab and to render the breadcrumb status.
- `src/git/status.ts` — a `Map<cwd, { value, at, busy }>` with a 15 s TTL and
  listeners; the shell and the git tab share one summary.

Shape of both: module-level `Map`/`Set`, exported setters, `subscribeX(listener)`
returning an unsubscribe, and a `useX()` binding for React. No event emitter
package.

### Host-owned state

- **Workspaces:** `useWorkspaces((snapshot) => snapshot.items)` — a host hook passed
  as a prop, then normalized once (`projectsOf`) and memoized.
- **Sessions / terminals:** `ctx.sessions.retain(sessionId, { source })` returns a
  reference that is released in an effect cleanup; a terminal model is created per
  tab with `useMemo` and closed by `closeTerminalModel` when the tab closes.
- **Row config:** never copied into state. The panel receives
  `appearance: () => Appearance` and calls it per render, so the settings card's
  volatile refs stay live.

---

## When to Use Global State

Promote something to the layout or a module store when at least one holds:

1. Two independent surfaces render it (shell breadcrumb + editor status).
2. It must outlive the component that created it (a closed tab's reopen history).
3. It is the reason a tab exists (which tab is active, what is open where).

Otherwise keep it local. A new module store needs a comment saying which two
surfaces share it.

---

## Server State

- **Not cached without a TTL.** `src/git/status.ts` is the only cache and documents
  its 15 s ceiling with a `ponytail:` comment.
- **Refetch on mount, not on every render**: the effect depends on `cwd`/`path`/
  `sessionId`, and a `stamp`/`token` counter is the explicit "again" signal.
- **Normalize at the boundary**: `projectsOf(items)`, `gitSummaryOf` build typed
  objects from untyped host payloads; nothing downstream re-reads the raw shape.
- **A failed host call degrades to a value**: `null` summary, an error card, an
  empty list — never a thrown error into render (`Guarded` is the last resort, one
  per embedded host surface).

---

## Common Mistakes

- **Mutating `Layout` in place** (`layout.projects[id].tabs.push(tab)`). React never
  sees a change and the persistence effect skips it.
- **Writing to `localStorage` from a view.** Only `WorkbenchPanel` owns the layout
  key; the last-panel key is owned by `rememberPanel`/`lastPanel`.
- **Duplicating derived data into state** (storing `activeTab` or `project` next to
  `layout`). Derive it in render; the repo derives `project`, `state`, `activeTab`
  inline.
- **Lifting view state to the shell "for later"** — that is how the layout object
  starts growing UI fields.
- **Copying a config value into state at mount**: the setting looks broken until a
  restart. Read the volatile ref where it is used.
- **A new store for one consumer.** Use a `useEffect` + local state (that is what
  `noteState` does in the shell) until a second consumer appears.
