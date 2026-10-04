import type { ConversationChannel, ConversationStatus } from './shared'

// ---------------------------------------------------------------------------
// MCR-5 — what the operator sees about automatic AI replies in one
// conversation. Pure (unit-tested): the server decides for real; this only
// explains the combined state of the business switch, the channel and the
// conversation's own pause.
// ---------------------------------------------------------------------------

/** Must mirror src/server/aiConversation/policy.ts AI_AUTO_REPLY_CHANNELS. */
const AUTO_REPLY_CHANNELS: readonly ConversationChannel[] = ['WHATSAPP']

export const AI_PAUSE_REASON_LABELS: Record<string, string> = {
  HUMAN_TAKEOVER: 'сотрудник ответил клиенту',
  OPERATOR_PAUSED: 'приостановлен вручную',
  CUSTOMER_REQUESTED_HUMAN: 'клиент попросил сотрудника',
  AI_NEEDS_HUMAN: 'AI передал диалог сотруднику',
  UNSAFE_REPLY: 'ответ AI не прошёл проверку',
  TURN_LIMIT: 'достигнут лимит автоответов подряд',
  AI_FAILURE: 'AI не смог ответить',
  UNSUPPORTED_MESSAGE: 'клиент прислал вложение или геолокацию',
}

export type AiAutomationView =
  | { kind: 'ACTIVE'; label: string; hint: string; canPause: true }
  | { kind: 'PAUSED'; label: string; hint: string; canResume: true }
  | { kind: 'UNAVAILABLE'; label: string; hint: string }

export function aiAutomationView(input: {
  businessEnabled: boolean
  channel: ConversationChannel
  status: ConversationStatus
  pausedAt: string | null
  pausedReason: string | null
}): AiAutomationView {
  if (!AUTO_REPLY_CHANNELS.includes(input.channel)) {
    return { kind: 'UNAVAILABLE', label: 'Автоответы AI недоступны', hint: 'Для этого канала AI отвечает только по кнопке «Предложить ответ AI».' }
  }
  if (input.pausedAt) {
    const why = (input.pausedReason && AI_PAUSE_REASON_LABELS[input.pausedReason]) || 'приостановлен'
    return { kind: 'PAUSED', label: 'AI приостановлен', hint: `Причина: ${why}. Новые сообщения клиента AI не отвечает.`, canResume: true }
  }
  if (!input.businessEnabled) {
    return { kind: 'UNAVAILABLE', label: 'Автоответы AI выключены', hint: 'Включаются владельцем или администратором в разделе AI.' }
  }
  if (input.status !== 'OPEN') {
    return { kind: 'UNAVAILABLE', label: 'Диалог закрыт', hint: 'AI отвечает только в открытых диалогах.' }
  }
  return { kind: 'ACTIVE', label: 'AI отвечает автоматически', hint: 'Если вы ответите клиенту сами, AI в этом диалоге остановится.', canPause: true }
}
