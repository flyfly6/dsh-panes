# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

"Backend" here is the Node half of a DSH plugin: `src/index.ts` (a Cordis plugin
with one `POST /dsh-panes/api` route), the pure modules behind its op table, and the
forked Git host half. There is no framework, no database and no service layer.

Files were written from the code as it exists on 2026-11-04 (branch `main`,
v0.1.1). When behaviour changes, the spec changes in the same commit.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Two halves, module layout, where a new op goes | Filled |
| [Persistence Guidelines](./database-guidelines.md) | No database: localStorage layout, notes vault, etag, config schema | Filled |
| [Error Handling](./error-handling.md) | `ApiError`/`NotesError`, codes, JSON envelope, trust fence | Filled |
| [Quality Guidelines](./quality-guidelines.md) | `pnpm check`, forbidden/required patterns, review checklist | Filled |
| [Logging Guidelines](./logging-guidelines.md) | `console` + `[dsh-panes]` prefix, degraded capability only | Filled |

---

## How to Read These Guidelines

1. Read the file for the layer you are about to touch, before writing code.
2. Copy the pattern from the cited example rather than inventing a variant.
3. If the code and this spec disagree, the code is what ships — fix the spec in the
   same change, and say which won.

---

**Language**: All documentation should be written in **English**.
