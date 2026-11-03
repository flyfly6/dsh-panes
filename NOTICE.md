# Third-party notices

This package bundles code from one upstream project. Its license text ships with
the package (`src/git/LICENSE`) and its fork notes live in `src/git/UPSTREAM.md`.

## dsh-ide-git (MIT)

- Source: https://github.com/KannaKuron/dsh-ide-git
- Version forked: **v0.21.1**
- Files: `src/git/host.js` (from `src/index.js`), `src/git/panel.js` (from `src/client.js`)
- License: MIT — Copyright (c) the dsh-ide-git authors. Full text: `src/git/LICENSE`.
- Changes: see `src/git/UPSTREAM.md` (seat registrations removed, row config moved,
  push/pull config gate, empty-repository handling). This copy has **diverged**:
  since 2026-11-03 it is maintained as part of this package and is no longer
  synced with upstream.

Anything else in this package is original: the workbench panel, tab model, file
and search views, conversation/terminal embedding and the host API.

Bundled dependencies keep their own licenses; the browser bundle inlines (among
others) React-free UI bits from Radix UI (MIT), lucide (ISC), shiki (MIT),
markdown-it (MIT), DOMPurify (MPL-2.0 OR Apache-2.0) and @xterm/xterm (MIT). Each
one's license text is available in its own package under `node_modules/` in this
repository and at its project page.
