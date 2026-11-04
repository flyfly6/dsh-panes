/**
 * One runnable check for the tab model: dedupe, per-project isolation,
 * close/reopen, reorder, and what survives a persist/reload round-trip.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  closeTab,
  emptyLayout,
  ensureProject,
  moveTab,
  openTab,
  parseLayout,
  projectState,
  reopenLast,
  serializeLayout,
  setSidebar,
  tabId,
} from '../src/tabs.ts'

const A = 'project-a'
const B = 'project-b'

function withProjects(...ids) {
  return ids.reduce((layout, id) => ensureProject(layout, id), emptyLayout())
}

test('opening the same file twice keeps one tab', () => {
  let layout = withProjects(A)
  layout = openTab(layout, A, { kind: 'file', contentId: 'src/app.ts', title: 'app.ts' })
  layout = openTab(layout, A, { kind: 'file', contentId: 'src/app.ts', title: 'app.ts' })
  assert.equal(projectState(layout, A).tabs.length, 1)
  assert.equal(projectState(layout, A).activeTabId, tabId(A, 'file', 'src/app.ts'))
})

test('the same file in two projects is two tabs', () => {
  let layout = withProjects(A, B)
  layout = openTab(layout, A, { kind: 'file', contentId: 'README.md', title: 'README.md' })
  layout = openTab(layout, B, { kind: 'file', contentId: 'README.md', title: 'README.md' })
  assert.equal(projectState(layout, A).tabs.length, 1)
  assert.equal(projectState(layout, B).tabs.length, 1)
  assert.notEqual(projectState(layout, A).tabs[0].id, projectState(layout, B).tabs[0].id)
})

test('closing activates a neighbour and remembers the tab for reopening', () => {
  let layout = withProjects(A)
  for (const name of ['a.ts', 'b.ts', 'c.ts']) {
    layout = openTab(layout, A, { kind: 'file', contentId: name, title: name })
  }
  layout = closeTab(layout, A, tabId(A, 'file', 'b.ts'))
  const state = projectState(layout, A)
  assert.deepEqual(state.tabs.map((tab) => tab.contentId), ['a.ts', 'c.ts'])
  assert.equal(state.activeTabId, tabId(A, 'file', 'c.ts'))
  assert.equal(state.closed[0].contentId, 'b.ts')

  layout = reopenLast(layout, A)
  assert.deepEqual(projectState(layout, A).tabs.map((tab) => tab.contentId), ['a.ts', 'c.ts', 'b.ts'])
  assert.equal(projectState(layout, A).activeTabId, tabId(A, 'file', 'b.ts'))
})

test('closing the active first tab falls back to the next one', () => {
  let layout = withProjects(A)
  layout = openTab(layout, A, { kind: 'file', contentId: 'a.ts', title: 'a.ts' })
  layout = openTab(layout, A, { kind: 'file', contentId: 'b.ts', title: 'b.ts' })
  layout = closeTab(layout, A, tabId(A, 'file', 'b.ts'))
  assert.equal(projectState(layout, A).activeTabId, tabId(A, 'file', 'a.ts'))
  layout = closeTab(layout, A, tabId(A, 'file', 'a.ts'))
  assert.equal(projectState(layout, A).activeTabId, null)
})

test('reorder moves a tab and ignores out-of-range indices', () => {
  let layout = withProjects(A)
  for (const name of ['a.ts', 'b.ts', 'c.ts']) {
    layout = openTab(layout, A, { kind: 'file', contentId: name, title: name })
  }
  layout = moveTab(layout, A, 2, 0)
  assert.deepEqual(projectState(layout, A).tabs.map((tab) => tab.contentId), ['c.ts', 'a.ts', 'b.ts'])
  assert.equal(moveTab(layout, A, 0, 9), layout)
})

test('sidebar width is clamped and persisted', () => {
  let layout = withProjects(A)
  layout = setSidebar(layout, A, { width: 999 })
  assert.equal(projectState(layout, A).sidebar.width, 320)
  layout = setSidebar(layout, A, { width: 10 })
  assert.equal(projectState(layout, A).sidebar.width, 200)
})

test('a reload keeps tabs, order, active tab and sidebar state', () => {
  let layout = withProjects(A)
  layout = openTab(layout, A, { kind: 'file', contentId: 'a.ts', title: 'a.ts' })
  layout = openTab(layout, A, { kind: 'explorer', contentId: '.', title: 'Explorer' })
  layout = openTab(layout, A, { kind: 'file', contentId: 'b.ts', title: 'b.ts' })
  layout = setSidebar(layout, A, { width: 300, collapsed: true })
  layout = { ...layout, activeProjectId: A }

  const restored = parseLayout(serializeLayout(layout))
  const state = projectState(restored, A)
  assert.equal(restored.activeProjectId, A)
  assert.deepEqual(state.tabs.map((tab) => tab.contentId), ['a.ts', '.', 'b.ts'])
  assert.equal(state.activeTabId, tabId(A, 'file', 'b.ts'))
  assert.deepEqual(state.sidebar, { width: 300, collapsed: true })
})

test('a reload keeps plugin-registered kinds, drops a stale schema and garbage', () => {
  const raw = JSON.stringify({
    schemaVersion: 2,
    activeProjectId: A,
    projects: {
      [A]: {
        tabs: [
          { kind: 'file', contentId: 'keep.ts', title: 'keep.ts' },
          { kind: 'from-the-future', contentId: 'x', title: 'x' },
        ],
        activeTabId: 'missing',
        closed: [],
        sidebar: { width: 248, collapsed: false },
      },
    },
  })
  const restored = parseLayout(raw)
  /* Unknown kinds survive: a registered tab type must outlive a page reload. */
  assert.deepEqual(projectState(restored, A).tabs.map((tab) => tab.kind), ['file', 'from-the-future'])
  /* v0.3 removed the browser tab; an old layout must still load, minus that tab. */
  const legacy = parseLayout(
    JSON.stringify({
      schemaVersion: 2,
      activeProjectId: A,
      projects: {
        [A]: {
          tabs: [{ kind: 'browser', contentId: 'https://example.com', title: 'example.com' }, { kind: 'file', contentId: 'a.ts', title: 'a.ts' }],
          sidebar: { width: 248, collapsed: false },
        },
      },
    }),
  )
  assert.deepEqual(projectState(legacy, A).tabs.map((tab) => tab.kind), ['file'])
  const garbage = parseLayout(
    JSON.stringify({
      schemaVersion: 2,
      activeProjectId: null,
      projects: { [A]: { tabs: [{ kind: '', contentId: 'x', title: 'x' }, { kind: 'file' }], sidebar: {} } },
    }),
  )
  assert.deepEqual(projectState(garbage, A).tabs, [])
  assert.equal(projectState(restored, A).activeTabId, tabId(A, 'file', 'keep.ts'))
  assert.deepEqual(parseLayout(JSON.stringify({ schemaVersion: 1, projects: {} })), emptyLayout())
  assert.deepEqual(parseLayout('not json'), emptyLayout())
})
