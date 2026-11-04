# Logging Guidelines

> There is no logging library. `console` is the channel, the prefix is the
> namespace, and the default is silence.

---

## Overview

- **No logger dependency, no log levels, no transports.** The host half runs inside
  someone else's process (DSH) and the client half inside their page: writing more
  than a handful of lines is noise the user cannot turn off.
- **Every message is prefixed `[dsh-panes]`** so a support paste is greppable:
  `console.warn('[dsh-panes] @deepseek/schemastery is not resolvable here: …')`.
- **Errors go out through the API envelope, not the log.** If a failure has a
  `code`, the client shows it; the console is for what the client cannot show.

---

## Log Levels

| Level | Use it for | In this repo |
|---|---|---|
| `console.error` | a bug in our code, unrecoverable | not used today — throw an `ApiError` instead |
| `console.warn` | a capability is missing, we continue degraded | `schemastery` unresolved (`src/config.ts`), embedded conversation crashed (`src/panel/Guarded.tsx`) |
| `console.info` / `console.log` | — | **not used**; do not add |
| `console.debug` | — | **not used**; do not add |

`src/git/host.js` keeps upstream's own logging; it is a vendored file, follow it
rather than "fixing" it to this convention.

---

## Structured Logging

No structure. Two rules make a plain line usable anyway:

1. Prefix: `[dsh-panes] ` at the start of the message.
2. Subject first, then the detail: what surface is missing, then the underlying
   message (`error instanceof Error ? error.message : String(error)`).

```ts
// src/config.ts
console.warn(
  `[dsh-panes] @deepseek-ai/schemastery is not resolvable here; the row config surface is absent: ${
    error instanceof Error ? error.message : String(error)
  }`,
)
```

**Stack parking for crash reports:** a `Guarded` boundary also writes the real stack
to `window.__panesLastError` (`src/panel/Guarded.tsx`) because the console channel
truncates frames. One line, no telemetry.

---

## What to Log

- A host surface the plugin probes and does not find (`schemastery`, `ctx.provide`,
  `ctx.workspaces.add`, `ctx.layout.panels.toggleSidebar`) — once, at the probe.
- A render boundary that caught an error (once per mount, with the error).
- Nothing on a hot path: no per-render, per-request or per-keystroke logging.

---

## What NOT to Log

- **Note bodies and file contents.** These are user documents.
- **Absolute user paths inside log lines** where avoidable — they travel in API
  error messages to the page that asked, not into a global console.
- **Config values verbatim** (a commit prompt may contain repo details; a vault path
  is a home directory).
- **Per-request access lines.** The route is called on every keystroke-debounce.
- Anything on the success path of an op.

---

## Common Mistakes

- Adding `console.log` to debug and leaving it. Delete it before the commit; the
  build does not strip it.
- Logging the thrown error *and* returning it to the client — one channel per fact.
- Logging inside a React render body: it fires per render and on StrictMode double
  invocations.
