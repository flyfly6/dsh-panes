/**
 * The loader row config of this plugin — the document behind the Plugins page
 * settings card and the values `apply(ctx, config)` reads.
 *
 * `@deepseek-ai/schemastery` is resolved lazily: a host that cannot resolve it
 * (standalone compositions, tests) loads the plugin with the config passed
 * through unvalidated instead of dropping the row.
 *
 * Every field the settings card writes MUST be declared here and marked
 * volatile, or the Host refuses the write ("Config field … is not volatile")
 * and the switch rolls back silently.
 */
import { RAIL_CONFIG_IDS } from './git/host.js'

let Schema: any = null
try {
  Schema = (await import('@deepseek-ai/schemastery')).default
} catch (error) {
  console.warn(
    '[dsh-workbench] @deepseek-ai/schemastery is not resolvable here; the row config surface is absent: '
      + (error instanceof Error ? error.message : String(error)),
  )
}

/** Volatile refs (dsh >= 0.1.7 settings contract) or plain values on older hosts. */
function live(schema: any): any {
  return typeof schema.volatile === 'function' ? schema.volatile() : schema
}

function build(schema: any): any {
  const shape: Record<string, unknown> = {
    /** Panel startup surface: 'workbench' (this panel) or 'conversation'. */
    startup: live(schema.string().default('workbench')),
    /* Git settings (T2 §R2.13). Empty strings mean "follow the session". */
    commitModel: live(schema.string().default('')),
    commitReasoning: live(schema.string().default('')),
    commitPrompt: live(schema.string().default('')),
    /** R2.10: push/pull/tag-push stay hidden and refused until this is on. */
    experimentalRemoteOps: live(schema.boolean().default(false)),
  }
  /* One switch per rail action, in rail order (RAIL_SPECS order in panel.js). */
  for (const id of RAIL_CONFIG_IDS) {
    shape[`rail${id.charAt(0).toUpperCase()}${id.slice(1)}`] = live(schema.boolean().default(true))
  }
  return schema.object(shape)
}

export const Config = Schema === null ? undefined : build(Schema)
