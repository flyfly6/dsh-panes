/**
 * Notes the user is editing right now, so the shell can refuse to close a tab
 * with unsaved text. Module state, because the tab model is a plain data model
 * and knows nothing about editors.
 */
const DIRTY = new Map<string, boolean>()
const listeners = new Set<() => void>()

export function setNoteDirty(path: string, dirty: boolean): void {
  if (dirty) DIRTY.set(path, true)
  else DIRTY.delete(path)
  for (const listener of listeners) listener()
}

export function isNoteDirty(path: string): boolean {
  return DIRTY.get(path) === true
}

export function subscribeNoteDirty(listener: () => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
