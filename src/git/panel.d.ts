/**
 * Hand-written types for the vendored panel (src/git/panel.js) — the only
 * surface the workbench touches. Everything else in that file is upstream's.
 */
export interface GitPanelModule {
  name: string
  inject: string[]
  /** Styles, locale dictionaries and the Plugins-page settings card. */
  apply(ctx: any): void
  /** `t` for the panel's own dictionary namespace. */
  translate(ctx: any): (key: string, values?: Record<string, string | number>) => string
  /** The panel component; needs `scope: { cwd, sessionId }`. */
  LocaleLive: (props: any) => any
  Panel: (props: any) => any
}

declare function createGitPanel(require: (id: string) => any): GitPanelModule
export default createGitPanel
