# Quality Guidelines

> The gate is small and mechanical: `pnpm check`. There is no ESLint config and no
> Prettier config in this repo — `tsc --noEmit` and `node --test` are the linters.

---

## Overview

| Command | What it does | When |
|---|---|---|
| `pnpm typecheck` | `tsc --noEmit`, strict, whole `src/` | every change |
| `pnpm test` | `node --test test/*.test.mjs` | every change |
| `pnpm build` | `build:styles` (Tailwind → `src/generated/styles.ts`) then `tsdown` + `wrap-client.mjs` | before publishing, and for `test/host.test.mjs` |
| `pnpm check` | build + typecheck + test | the full gate |
| `node --check src/git/*.js` | parse check on the vendored fork | after touching `src/git/` |

Node 24 runs `test/*.test.mjs` and imports `../src/*.ts` directly through type
stripping. That is why `src/notes.ts` writes `NotesError` fields by assignment
instead of constructor parameter properties — parameter properties are rejected by
type stripping ("Plain fields, not constructor parameter properties" comment).
Keep new source in that subset, or the tests stop loading.

CI (`.github/workflows/publish.yml`) runs on `v*` tags only: it installs with
`--frozen-lockfile`, checks the tag equals `package.json` version, then
`npm publish` (OIDC, no token in the repo). `prepublishOnly` builds `lib/`.

---

## Forbidden Patterns

| Forbidden | Why |
|---|---|
| Editing or committing `lib/` | Build output, gitignored; the next build overwrites it |
| Adding a runtime dependency for what the stdlib or an installed dep does | The browser bundle is ~9 MB; every kilo is a page-load cost |
| A new error class per module | The route reads `{ code, message, status }`; reuse `ApiError` / `NotesError` |
| Unbounded filesystem scans / unbounded body reads | There is a budget constant for each — reuse it |
| `child_process` string forms or shell interpolation | argv arrays only (`path.reveal`, `runRg`, `src/git/host.js`) |
| `any` on a value that then flows into app state | Normalize at the boundary instead (`projectsOf`, `gitSummaryOf`) |
| Silent `catch {}` on a real error | `.catch(() => null)` only for "the answer is no" |
| New `console.log` on a success path | See `logging-guidelines.md` |
| `[workbench-fork]` markers in `src/git/` | That tree is ours since 2026-11-03; record changes in `src/git/UPSTREAM.md` |

---

## Required Patterns

- **One op per capability, one module behind it** (`src/index.ts` + `src/<area>.ts`).
- **Validate and normalize at every boundary**: request fence, body limit, op name,
  config refs, persisted layout, remote payloads.
- **Budgets as named constants** at the top of the module (`BODY_LIMIT`, `MAX_HITS`,
  `CONCURRENCY`, `TTL`, `MAX_BODY`).
- **Cleanup is part of the feature**: `ctx.effect` returns a disposer for every
  route / listener / timer, and a `live` flag cancels in-flight promise writes in
  effects.
- **Mark deliberate short-cuts** with a `ponytail:` comment naming the ceiling and
  the upgrade path (`src/git/status.ts`, `src/panel/Guarded.tsx`).
- **Comments explain why, in English, briefly.** No comment restates the code.

---

## Testing Requirements

- **One test file per testable module**, `test/<module>.test.mjs`, `node:test` +
  `node:assert/strict`, no framework, no fixtures, no mocks directory.
- **Test names are behaviour sentences**: `'a request without the plugin header is
  refused'`, `'closing activates a neighbour and remembers the tab for reopening'`.
- **`test/host.test.mjs` runs against the built `lib/index.js`** — it doubles as a
  build smoke test; run `pnpm build` before it or it tests stale output.
- **Pure logic gets tested, UI does not.** There is no DOM/jsdom setup: `tabs.ts`,
  `search.ts`, `notes.ts`, `ripgrep.ts` and the git guards carry the tests. React
  views are verified by loading the panel in a profile.
- **A bug fix gets the assertion that would have caught it.** A test that cannot fail
  when the logic breaks is not a test.

---

## Code Review Checklist

- [ ] Does the change keep `src/index.ts` a transport, or did domain logic leak in?
- [ ] New failure path: does it carry a `code` + `status`, and does the client have
      a branch for it?
- [ ] New user-visible string: present in **both** `zh` and `en` in `src/locale.ts`?
- [ ] New persisted field: re-validated on read, and does an old payload still load?
- [ ] New `ctx.*` probe: does a missing service degrade instead of throw?
- [ ] Every effect / listener / timer / child process disposed?
- [ ] `pnpm check` green, plus `node --check src/git/panel.js` if the fork changed?
- [ ] `src/git/UPSTREAM.md` change table updated if fork behaviour changed?
