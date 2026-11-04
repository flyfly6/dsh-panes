/**
 * Tab glyphs, one per kind, in the colours the design uses (design §2.0b: "每种
 * tab 类型有图标与色"). A kind registered by another plugin that brings no icon
 * of its own falls back to the generic file glyph, so the strip never renders an
 * undefined component.
 */
import * as React from 'react'
import {
  AppWindow,
  FileCode2,
  FileText,
  FolderTree,
  GitBranch,
  Search,
  SquareTerminal,
  StickyNote,
} from 'lucide-react'

/** kind → glyph + its colour class (design: file blue, git brown, the rest muted). */
const GLYPHS: Record<string, { Icon: React.ComponentType<{ className?: string }>; color: string }> = {
  session: { Icon: AppWindow, color: 'text-muted-foreground' },
  file: { Icon: FileCode2, color: 'text-[#3B6FF5]' },
  explorer: { Icon: FolderTree, color: 'text-muted-foreground' },
  search: { Icon: Search, color: 'text-muted-foreground' },
  terminal: { Icon: SquareTerminal, color: 'text-muted-foreground' },
  git: { Icon: GitBranch, color: 'text-[#B07219]' },
  note: { Icon: StickyNote, color: 'text-muted-foreground' },
  notes: { Icon: FileText, color: 'text-muted-foreground' },
}

export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  const glyph = GLYPHS[kind] ?? GLYPHS['file']!
  const Icon = glyph.Icon
  return <Icon className={`${glyph.color} ${className ?? 'h-3 w-3'}`} aria-hidden />
}
