# Error Handling

> Every failure crosses one boundary: the plugin route. Nothing throws past it,
> and the client branches on `code`, never on message text.

---

## Overview

There are two error shapes in the repo and they are deliberately compatible:

| Error | File | Fields |
|---|---|---|
| `ApiError` | `src/index.ts` | `code`, `message`, `status` (default 400) |
| `NotesError` | `src/notes.ts` | `code`, `message`, `status` (default 400) |

`src/search.ts` has no class of its own: it throws
`Object.assign(new Error(msg), { code, status })`, which the route reads through
the same fields. **Do not invent a third shape** — the handler casts to
`{ code?, message?, status? }` and serializes whatever it finds.

---

## Error Types

Codes are strings, prefixed by namespace where the op table has one:

- transport / request: `forbidden` (403), `method-error` (405), `too-large` (413),
  `transport` (500), `bad-request` (400), `unknown-op` (404), `internal` (500)
- search: `bad-root`, `bad-pattern`
- path: `bad-path`, `not-found`
- notes: `notes/bad-path`, `notes/bad-vault`, `notes/vault-unwritable`,
  `notes/not-found`, `notes/too-large`, `notes/conflict`, `notes/name-exhausted`
- git: `disabled-by-config` (403) and the forked table's own codes

The client keys behaviour off the code — `FileView` decides "binary" with
`result.error.code.includes('not-text')`, the note editor turns `notes/conflict`
into its conflict state. Renaming a code is a breaking change for a view.

---

## Error Handling Patterns

1. **Validate at the trust boundary first, and fail closed.** `createHandler` checks
   the loopback / `sec-fetch-site` fence *and* `x-dsh-plugin: dsh-panes` before it
   reads a byte of the body; then method, then body size, then JSON, then the op
   name. Any miss answers JSON — the route never 500s on parser input.
2. **Bound every read.** `readJsonBody` enforces `BODY_LIMIT` (1 MiB) and rejects
   `too-large` while destroying the request. A large client request must not be
   buffered to completion first.
3. **Propagate by throwing; translate at the edge.** Modules throw `ApiError` /
   `NotesError`; `createHandler` is the only place that turns a throw into a status
   and a JSON body.
4. **Degrade, don't crash, on optional host surfaces.** Missing `schemastery`
   (`src/config.ts`), a missing `ctx.provide` / `ctx.workspaces.add`
   (`src/client.tsx`), an unusable `rg` (`src/search.ts` falls back to the JS walk)
   or an unknown git state all log once and continue with the reduced capability.
5. **`catch` with a reason.** `.catch(() => null)` is for "the answer to the
   question is no" (file missing, `git` not a repo). A real error path rethrows with
   a code, or reports into the UI. Never swallow into a silent `undefined`.
6. **Aborts are not errors.** `res.on('close')` aborts the scan's `AbortSignal`;
   the client ignores `AbortError` (`SearchView`). A superseded request is silent.
7. **rg exit codes:** `0` and `1` are success (1 = no match); anything else rejects
   (`src/ripgrep.ts`). Encoding this wrong makes "no results" look like a failure.

---

## API Error Responses

One envelope, always JSON, always `no-store`:

```jsonc
// success
{ "ok": true, "data": <op result> }
// failure — HTTP status matches `status`, `code` is the client's switch key
{ "ok": false, "code": "notes/conflict", "message": "the note changed on disk — reload or overwrite" }
```

The client wrapper is `src/api.ts`:

```ts
export class ApiCallError extends Error { code: string /* … */ }
// call() throws ApiCallError(code, message); views branch on error.code
```

---

## Common Mistakes

- **Adding an op that throws a bare string or a non-Error object.** The route reads
  `error.message` / `error.code`; a string loses both.
- **Returning `{ ok: false }` from inside an op.** Ops return data or throw — the
  handler owns the envelope.
- **Putting user-supplied detail into a 500.** A 500 means "we did not expect this";
  a bad path / bad pattern is a 400 with its own code.
- **Assuming a host service exists.** `ctx.webTerminals`, `ctx.remote`,
  `ctx.workspaces.add`, `ctx.layout.panels.toggleSidebar` are all probed at the call
  site; a missing one renders a refusal, never an exception through a component.
- **Wrapping the whole route in a try/catch without a status.** The handler already
  does that; a second blanket catch hides the code the client needs.
