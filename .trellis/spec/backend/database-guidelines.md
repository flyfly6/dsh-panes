# Persistence Guidelines

> **There is no database in this project.** No ORM, no SQL, no migrations, no
> schema tooling. The file name is kept for template compatibility; this is what
> actually persists, and the rules that keep it from corrupting user data.

---

## Overview

| Surface | Owner | Where | Lifetime |
|---|---|---|---|
| Tab layout | browser half | `localStorage['dsh-panes:layout']` | until cleared |
| Notes vault | host half | filesystem — `$DSH_HOME/notes` or a configured absolute dir | user files |
| Git summary | browser half | in-memory `Map`, 15 s TTL (`src/git/status.ts`) | process |
| Row config | host (schemastery) | the profile's config document | until reset |

Nothing else survives a reload. Search results, scroll position, cursor and
expanded tree nodes are deliberately **not** persisted.

---

## Query Patterns

- Read a file once per view, not per render. `FileView` pages 800 lines at a time
  through `remote.workspaceFiles.read({ offset, limit })` and appends on demand;
  `state.eof` stops the paging.
- Anything that scans a tree is capped and abortable — `MAX_FILES`, `MAX_HITS`,
  `MAX_FILE_BYTES`, `AbortSignal` in `src/search.ts`. Do not add an unbounded scan.
- Cache only what the chrome needs, only with a TTL, and say so with a
  `ponytail:` comment (`src/git/status.ts` documents its 15 s ceiling).

---

## Migrations

There are no migration functions. Two versioned surfaces exist, both versioned
by a constant:

- **Layout** (`src/tabs.ts`): `SCHEMA_VERSION = 2`. Bump it and old layouts come
  back empty (`parseLayout` returns `emptyLayout()` on a mismatch). If real
  migration is ever needed, this paragraph is the thing to rewrite — not to work
  around with an ad-hoc fallback.
- **Row config** (`src/config.ts`): the schema *is* the migration. Every field the
  settings card writes must be declared and marked volatile
  (`live(schema.string())`), otherwise the Host refuses the write and the switch
  rolls back silently. Read values through the volatile ref at use time
  (`plainConfig()`, `value()`), never as a startup snapshot.

---

## Client layout (`src/tabs.ts`)

- One `Layout` object, serialized with `serializeLayout`, read with `parseLayout`.
- **Parsing never throws and never trusts.** Corrupt JSON, a wrong type, a missing
  key or a stale `schemaVersion` all yield `emptyLayout()`; malformed tab entries
  are dropped one at a time (`parseTab`); widths are clamped to `SIDEBAR_WIDTH`;
  an `activeTabId` naming no tab falls back to the first tab.
- **Unknown tab kinds survive a reload.** A kind registered by another plugin must
  outlive the page it was opened on: the shell renders its "not available" card
  instead of the parser deleting the tab.

---

## Notes vault (`src/notes.ts`)

- **One `.md` file per note**, addressable only vault-relative and POSIX-style
  (`relativeOf`): absolute paths, NUL bytes, `..`, an empty path, a non-`.md` name
  and anything under `.trash/` are refused with `notes/bad-path`.
- **Path fence, then symlink check.** `notePath` re-checks
  `path.relative(root, abs)` and refuses a symlink via `lstat` — a link inside the
  vault can point outside it, and `readFile` / `stat` would follow it out.
- **Writes are atomic.** `atomicWrite` writes `<file>.<pid>.<ts>.tmp` and `rename`s
  it over the note, removing the temp file on failure. Never `writeFile` straight
  onto a note.
- **Frontmatter is host-owned.** The client edits the body only;
  `splitFrontmatter` / `upsertFrontmatter` keep unknown fields and their order, and
  stamp `updated`.
- **Optimistic concurrency by etag.** `etagOf(mtimeMs, size)` →
  `"<roundedMtime>:<size>"`. A write whose etag no longer matches answers
  `notes/conflict` (409), so an outside edit (Obsidian, another editor) becomes a
  conflict instead of a silent overwrite.
- **Deletes go to `.trash/`** as `<stamp>-<basename>`, never `unlink` directly.
- Caps: body `4 MiB` (`MAX_BODY` → 413 `notes/too-large`), search `200` hits. The
  vault root is created on demand; a bad configured root is
  `notes/vault-unwritable` (500), not a crash.

---

## Naming Conventions

| Thing | Convention | Examples |
|---|---|---|
| localStorage keys | `dsh-panes:<what>` | `dsh-panes:layout`, `dsh-panes:last-panel` |
| Note files | slug from the title, `.md` suffix, `-2`/`-3` on collision | `meeting-notes.md` |
| Note paths on the wire | vault-relative, `/`-separated | `inbox/idea.md` |
| Etags | `"<ignored-decimal-mtime>:<size>"` — opaque to the client | `1710:812` |
| Error codes | `notes/<cause>` | `notes/conflict`, `notes/bad-path` |

---

## Common Mistakes

- **Editing `lib/` instead of `src/`.** `lib/` is build output and gitignored; the
  next `pnpm build` erases it.
- **Adding a settings field to the UI without adding it to `src/config.ts`.** The
  write is refused by the Host and rolls back with no visible error.
- **Capturing a config value once** (`const startup = value(config, 'startup')` at
  module scope) instead of reading the ref per use — the settings card then appears
  dead until a restart.
- **Trusting `JSON.parse` output straight into app state.** Everything persisted is
  re-validated on read: `parseLayout`, `parseTab`, `projectsOf`, the `git` summary
  normalizer.
- **Non-atomic note writes.** A crash mid-`writeFile` leaves a truncated note; use
  `atomicWrite`.
