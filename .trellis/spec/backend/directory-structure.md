# Directory Structure

> How the Node (host) half of this package is organized.

---

## Overview

`dsh-panes` is one npm package with two halves, and only one of them is "backend":

| Half | Entry | Artifact | Runtime |
|---|---|---|---|
| Host (this document) | `src/index.ts` | `lib/index.js` (ESM) | Node, loaded by Cordis |
| Browser | `src/client.tsx` | `lib/client.js` (CJS inside a loader factory) | page |

There is no framework, no router and no service layer. The host half is **one
HTTP surface plus pure modules behind it**. `src/api.ts` is client-facing and
lives in the same folder; do not add Node-only imports to it.

---

## Directory Layout

```
src/
├── index.ts      cordis plugin: name / inject / Config, POST /dsh-panes/api, op table
├── config.ts     loader row config schema (schemastery, volatile refs)
├── search.ts     workspace search (name + content), engine ladder, budgets
├── ripgrep.ts    rg resolution (system → @vscode/ripgrep) and the child runner
├── notes.ts      notes vault ops on the filesystem, frontmatter, etag conflicts
├── api.ts        browser-side call() helper + wire types (client half)
├── git/host.js   forked Git host half, mounted as a child fiber of this plugin
test/
├── host.test.mjs  the route's trust fence, run against the built lib/index.js
└── <module>.test.mjs
scripts/          build-styles.mjs, wrap-client.mjs — build only, never imported
lib/              build output; gitignored, never edited, never committed
```

---

## Module Organization

1. **A new host capability is a module plus one op.** Put the logic in
   `src/<area>.ts` as exported plain async functions that take a plain object and
   throw `ApiError`; register the entry in `createOps()` inside `src/index.ts`.
   Genuine one-liners stay inline (`ping`, `path.reveal`).
2. **`src/index.ts` stays transport.** Trust fence, body limit, op dispatch, JSON
   envelope. No domain logic gets added there.
3. **Reachable modules must not need `ctx`.** Tests import them directly, so
   module-level caches are fine (`rgPath()` in `src/ripgrep.ts` memoizes the
   binary) but nothing may require a live plugin context.
4. **State that belongs to a running host goes through the config reader.**
   `createOps(readConfig)` / `createNotesOps(readConfig)` take a thunk instead of a
   snapshot, so a settings write applies on the next call.
5. **Vendored forks keep their layout.** `src/git/host.js` and `src/git/panel.js`
   stay as upstream wrote them (provenance in `src/git/UPSTREAM.md`), with
   hand-written `.d.ts` beside them; typecheck never looks inside.

---

## Naming Conventions

| Thing | Convention | Examples |
|---|---|---|
| Files | lowercase, single word or kebab | `search.ts`, `ripgrep.ts`, `notes.ts` |
| Ops | dotted namespace, lowercase | `notes.write`, `path.reveal`, `git.status` |
| Error codes | namespace/cause, kebab after the slash | `notes/conflict`, `bad-root`, `unknown-op` |
| Exported functions | verb-first | `resolveRoot`, `createHandler`, `runRg` |
| React components | PascalCase file + export | `FileView.tsx` → `FileView` |

---

## Examples

- **Pure module behind one op:** `src/search.ts` — `search()` dispatches name vs
  content mode; failures are `ApiError` or `Object.assign(new Error(...), { code,
  status })`, and the `search` op in `src/index.ts` is a single forwarding line.
- **Op table with its own error family:** `createNotesOps()` in `src/notes.ts`
  returns `{ 'notes.list', 'notes.read', 'notes.write', … }`; `NotesError` carries
  the same `code` / `message` / `status` shape the route serializes.
- **Forked half mounted as a child fiber:** the second `ctx.effect` in
  `src/index.ts` (`ctx.plugin(gitHost, config)`) so disabling the plugin tears both
  route sets down together.
