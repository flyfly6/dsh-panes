/**
 * The `git` tab: the vendored dsh-ide-git panel, mounted inside the workbench
 * instead of a sidebar seat.
 *
 * adapter = the whole fork seam. src/git/panel.js is upstream's bundle with its
 * self-registration removed; this file gives it a context, a `t`, and the
 * `{ cwd, sessionId }` scope the panel expects. See src/git/UPSTREAM.md.
 */
import { createElement } from 'react'
import createGitPanel, { type GitPanelModule } from './panel.js'

let loaded: GitPanelModule | null = null
const translators = new Map<unknown, (key: string, values?: Record<string, string | number>) => string>()

/** One module instance per page: the panel keeps its repo and first-paint caches there. */
function gitModule(): GitPanelModule {
  if (loaded === null) loaded = createGitPanel(require)
  return loaded
}

function translatorFor(ctx: unknown) {
  let t = translators.get(ctx)
  if (t === undefined) {
    t = gitModule().translate(ctx)
    translators.set(ctx, t)
  }
  return t
}

/** Mount the host-side pieces the panel needs (styles, dictionaries, settings card). */
export function applyGitPanel(ctx: any): void {
  gitModule().apply(ctx)
}

/** The tab body. `cwd` is the project root: the panel finds the repository from it. */
export function GitTab({ ctx, cwd, sessionId }: { ctx: any; cwd: string; sessionId?: string }) {
  return createElement(gitModule().LocaleLive, {
    ctx,
    scope: { cwd, sessionId },
    t: translatorFor(ctx),
    visible: true,
  })
}
