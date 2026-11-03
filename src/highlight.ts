/**
 * Syntax highlighting via shiki, bundled (S2: `shiki` is not in the host's shared
 * module table). One lazily-created highlighter, two GitHub themes, a fixed
 * language set — the panel only needs to read code, not every grammar in the world.
 */
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import bash from 'shiki/langs/bash.mjs'
import css from 'shiki/langs/css.mjs'
import diff from 'shiki/langs/diff.mjs'
import go from 'shiki/langs/go.mjs'
import html from 'shiki/langs/html.mjs'
import java from 'shiki/langs/java.mjs'
import javascript from 'shiki/langs/javascript.mjs'
import json from 'shiki/langs/json.mjs'
import jsx from 'shiki/langs/jsx.mjs'
import markdown from 'shiki/langs/markdown.mjs'
import python from 'shiki/langs/python.mjs'
import rust from 'shiki/langs/rust.mjs'
import sql from 'shiki/langs/sql.mjs'
import tsx from 'shiki/langs/tsx.mjs'
import typescript from 'shiki/langs/typescript.mjs'
import yaml from 'shiki/langs/yaml.mjs'
import githubDark from 'shiki/themes/github-dark.mjs'
import githubLight from 'shiki/themes/github-light.mjs'

const THEMES = { light: githubLight, dark: githubDark } as const
type ThemeKey = keyof typeof THEMES

const LANGS = [
  bash,
  css,
  diff,
  go,
  html,
  java,
  javascript,
  json,
  jsx,
  markdown,
  python,
  rust,
  sql,
  tsx,
  typescript,
  yaml,
]

/** Extension → shiki language id. Anything absent renders as plain text. */
const BY_EXTENSION: Record<string, string> = {
  bash: 'bash',
  cjs: 'javascript',
  css: 'css',
  diff: 'diff',
  go: 'go',
  htm: 'html',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'jsx',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  patch: 'diff',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  sql: 'sql',
  ts: 'typescript',
  tsx: 'tsx',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
}

const BY_NAME: Record<string, string> = {
  dockerfile: 'bash',
  makefile: 'bash',
}

export function languageOf(path: string): string | undefined {
  const name = (path.split('/').pop() ?? '').toLowerCase()
  const byName = BY_NAME[name]
  if (byName !== undefined) return byName
  const dot = name.lastIndexOf('.')
  if (dot < 0) return undefined
  return BY_EXTENSION[name.slice(dot + 1)]
}

let pending: Promise<HighlighterCore> | null = null

function highlighter(): Promise<HighlighterCore> {
  pending ??= createHighlighterCore({
    themes: [THEMES.light, THEMES.dark],
    langs: LANGS,
    engine: createJavaScriptRegexEngine(),
  })
  return pending
}

/**
 * Host dark mode. dsh marks it with an attribute on `<body>` whose *presence*
 * is the signal (`data-ds-dark-theme=""`), and sets `color-scheme: dark` on the
 * root element; older builds used `data-ds-dark-theme="dark"` on `<html>`.
 */
export function isDark(): boolean {
  const body = document.body
  if (body !== null && body.hasAttribute('data-ds-dark-theme')) return body.getAttribute('data-ds-dark-theme') !== 'light'
  const root = document.documentElement
  if (root.dataset.dsDarkTheme !== undefined) return root.dataset.dsDarkTheme !== 'light'
  if (root.style.colorScheme === 'dark') return true
  if (root.classList.contains('dark')) return true
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
}

/** Human label for the status bar / breadcrumb ("TypeScript JSX", not "tsx"). */
const LABELS: Record<string, string> = {
  bash: 'Shell Script',
  css: 'CSS',
  diff: 'Diff',
  go: 'Go',
  html: 'HTML',
  java: 'Java',
  javascript: 'JavaScript',
  json: 'JSON',
  jsx: 'JavaScript JSX',
  markdown: 'Markdown',
  python: 'Python',
  rust: 'Rust',
  sql: 'SQL',
  tsx: 'TypeScript JSX',
  typescript: 'TypeScript',
  yaml: 'YAML',
}

export function languageLabel(path: string): string {
  const language = languageOf(path)
  if (language === undefined) return 'Plain Text'
  return LABELS[language] ?? language
}

/** Markdown fence aliases → loaded grammar id. */
const BY_ALIAS: Record<string, string> = {
  js: 'javascript',
  jsx: 'jsx',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  ts: 'typescript',
  tsx: 'tsx',
  yml: 'yaml',
  zsh: 'bash',
}

/** Highlight one fenced code block by language name (markdown preview). */
export async function highlightCode(lang: string, code: string): Promise<string | null> {
  const id = BY_ALIAS[lang.toLowerCase()] ?? (BY_EXTENSION[lang.toLowerCase()] !== undefined ? lang.toLowerCase() : undefined)
  if (id === undefined) return null
  try {
    const instance = await highlighter()
    return instance.codeToHtml(code, { lang: id, theme: isDark() ? 'github-dark' : 'github-light' })
  } catch {
    return null
  }
}

const MAX_LINE = 5000

export async function highlightToHtml(path: string, code: string): Promise<string | null> {
  const lang = languageOf(path)
  if (lang === undefined) return null
  for (const line of code.split('\n')) if (line.length > MAX_LINE) return null
  try {
    const instance = await highlighter()
    return instance.codeToHtml(code, { lang, theme: isDark() ? 'github-dark' : 'github-light' })
  } catch {
    return null
  }
}
