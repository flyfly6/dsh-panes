import * as React from 'react'

/**
 * Embedded conversation for one Session, rendered through the host's own
 * `conversation.content` factory (the same path `ui-subagent`'s sidebar chat uses).
 *
 * The factory is session-scoped, so this component only ever mounts inside a
 * `SessionProvider` — the panel wraps it with the slot's own provider prop.
 */
export interface ConversationSlotProps {
  sessionId: string
  useSession: (selector: (value: any) => unknown) => any
  useConversation: (selector: (value: any) => unknown) => any
  useSessions: (selector: (value: any) => unknown) => any
  renderFactorySlot: (name: string, input: unknown, options?: unknown) => unknown
}

/** The factory asks the caller which view fills the transcript: the chat one. */
function ChatViews(props: { renderSlot: (key: string, owner: unknown) => React.ReactNode }) {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

export function ConversationSlot({ sessionId, useSession, useConversation, useSessions, renderFactorySlot }: ConversationSlotProps) {
  const session = useSession((value: any) => value)
  const conversation = useConversation((value: any) => value)
  const summaryBlank = useSessions((state: any) => state.byId?.[sessionId]?.blank)

  const active =
    (conversation?.activeTargets?.size ?? 0) > 0 || (!session.blank && !session.awaitingFirstTurn) || session.running
  const settling = !active && session.openState === 'loading' && summaryBlank !== true
  const hero = !active && !settling && (session.openState === 'open' || summaryBlank === true)
  const phase: 'settling' | 'hero' | 'active' = settling ? 'settling' : hero ? 'hero' : 'active'

  return <>{renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, { slots: { views: ChatViews } })}</>
}
