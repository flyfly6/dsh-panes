/**
 * Notes the user is editing right now, so the shell can refuse to close a tab
 * with unsaved text. Module state, because the tab model is a plain data model
 * and knows nothing about editors.
 */
const DIRTY = new Map<string, boolean>()
const STATUS = new Map<string, string>()
const statusListeners = new Set<() => void>()

export function setNoteDirty(path: string, dirty: boolean): void {
  if (dirty) DIRTY.set(path, true)
  else DIRTY.delete(path)
}

export function isNoteDirty(path: string): boolean {
  return DIRTY.get(path) === true
}

/** `saved` | `dirty` | `saving` | `conflict` — shown in the tab's breadcrumb. */
export function setNoteStatus(path: string, status: string): void {
  STATUS.set(path, status)
  for (const listener of statusListeners) listener()
}

export function noteStatusOf(path: string): string {
  return STATUS.get(path) ?? ''
}

export function subscribeNoteStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => void statusListeners.delete(listener)
}
