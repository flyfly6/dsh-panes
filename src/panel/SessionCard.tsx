import * as React from 'react'
import { MessageSquare } from 'lucide-react'
import { Button } from '../ui/button'
import type { Translate } from './types'

interface Props {
  sessionId: string
  onOpen: () => void
  t: Translate
}

/**
 * Session tab body.
 *
 * The host unmounts the conversation DOM while another `main` panel is selected,
 * and `@deepseek-ai/dsh-client-ui-conversation` exports no reusable view component
 * (only controllers/registries — probed 2026-11-03). So a session tab cannot embed
 * a second copy without re-implementing the chat. It stays a single-instance
 * handle: one tab per session, and opening it returns to the host conversation.
 */
export function SessionCard({ sessionId, onOpen, t }: Props) {
  return (
    <div className="grid h-full place-content-center gap-3 px-6 text-center">
      <div className="mx-auto grid h-9 w-9 place-items-center rounded-full bg-muted text-muted-foreground">
        <MessageSquare className="h-4 w-4" aria-hidden />
      </div>
      <div className="text-sm text-foreground">{t('session.title')}</div>
      <div className="font-mono text-2xs text-muted-foreground">{sessionId}</div>
      <div className="mx-auto max-w-[46ch] text-xs text-muted-foreground">{t('session.note')}</div>
      <div>
        <Button variant="outline" size="sm" onClick={onOpen}>
          {t('session.back')}
        </Button>
      </div>
    </div>
  )
}
