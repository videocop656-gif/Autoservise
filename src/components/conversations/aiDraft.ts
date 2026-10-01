// ---------------------------------------------------------------------------
// Prompt 53 — pure helpers behind "Предложить ответ AI" in Conversation
// Detail. The draft is only ever operator-side composer text: these decide
// when the action is offered and make sure an AI draft never replaces what
// the operator has typed.
// ---------------------------------------------------------------------------

export type MessageDirection = 'INBOUND' | 'OUTBOUND'

export type AiDraftAvailability = { enabled: true; hint: null } | { enabled: false; hint: string | null }

/**
 * Offered only when it makes sense and is safe: the conversation ends with
 * a customer message to answer, and the composer is empty (an AI draft never
 * overwrites operator text — the operator clears the field first).
 */
export function aiDraftAvailability(input: {
  composer: string
  generating: boolean
  lastMessageDirection: MessageDirection | null
}): AiDraftAvailability {
  if (input.generating) return { enabled: false, hint: null }
  if (input.lastMessageDirection !== 'INBOUND') {
    return { enabled: false, hint: 'Нет нового сообщения клиента, на которое нужно ответить.' }
  }
  if (input.composer.trim() !== '') {
    return { enabled: false, hint: 'Чтобы получить ответ AI, сначала очистите поле сообщения.' }
  }
  return { enabled: true, hint: null }
}

/**
 * Puts a finished draft into the composer — only if it is still empty. The
 * operator may have started typing while the AI was working; that text wins.
 */
export function applyAiDraft(currentComposer: string, draft: string): { composer: string; applied: boolean } {
  if (currentComposer.trim() !== '') return { composer: currentComposer, applied: false }
  return { composer: draft, applied: true }
}

/** Server messages for these codes are already operator-facing Russian; anything else gets one retryable message. */
const PASS_THROUGH_CODES = new Set(['CONVERSATION_CLOSED', 'NO_CUSTOMER_MESSAGE', 'NOT_FOUND'])

export const AI_DRAFT_FAILED_MESSAGE = 'Не удалось подготовить ответ AI. Попробуйте ещё раз.'

export function aiDraftErrorMessage(code: string | undefined, serverMessage: string | undefined): string {
  return code && PASS_THROUGH_CODES.has(code) && serverMessage ? serverMessage : AI_DRAFT_FAILED_MESSAGE
}
