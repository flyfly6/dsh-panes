/**
 * Types for the vendored host half (src/git/host.js). Only the surface the
 * workbench mounts or reads is declared; the method table is internal.
 */
/** Rail action ids, in rail order — the source of truth for the row config schema. */
export const RAIL_CONFIG_IDS: string[]
export const name: string
export const inject: string[]
export function configure(config: Record<string, unknown>): void
export function apply(ctx: any, config?: Record<string, unknown>): void
