# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

"Frontend" here is the browser half of a DSH plugin: `src/client.tsx` (the Cordis
plugin that registers one `main` panel plus its sidebar row) and the React panel it
renders — a project sidebar with per-project tabs. React 18, Tailwind with preflight
off, shadcn primitives, one bundled file produced by tsdown + a loader wrapper.

Files were written from the code as it exists on 2026-11-04 (branch `main`, v0.1.1).
When behaviour changes, the spec changes in the same commit.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Two halves, `src/panel` / `ui` / `notes` / `git`, how a tab kind is added | Filled |
| [Component Guidelines](./component-guidelines.md) | Function components, props, shadcn + Tailwind tokens, a11y | Filled |
| [Hook Guidelines](./hook-guidelines.md) | `call()` fetching, live flags, module-store hooks, cleanup | Filled |
| [State Management](./state-management.md) | Layout model in `tabs.ts`, module stores, host-owned state | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Bundle constraints, forbidden patterns, review checklist | Filled |
| [Type Safety](./type-safety.md) | strict `tsc`, boundary normalization, unions, `.d.ts` for vendors | Filled |
| [DSH Plugin Contract](./dsh-plugin-contract.md) | Verified host/client plugin contract: panel registration, shared modules, API route, install loop | Verified 2026-11-03 |

---

## How to Read These Guidelines

1. Read the file for the layer you are about to touch, before writing code.
2. Copy the pattern from the cited example rather than inventing a variant.
3. If the code and this spec disagree, the code is what ships — fix the spec in the
   same change, and say which won.

---

**Language**: All documentation should be written in **English**.
