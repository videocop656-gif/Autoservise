// ---------------------------------------------------------------------------
// MCR-6 — operator wording for the recovery route of a missed call. The
// server stores stable codes (CallInteraction.recoveryRouteReason); operators
// only ever see these Russian sentences, never a raw enum.
// ---------------------------------------------------------------------------

export const RECOVERY_ROUTE_LABELS: Record<'WHATSAPP' | 'SMS_BRIDGE', string> = {
  WHATSAPP: 'WhatsApp',
  SMS_BRIDGE: 'SMS со ссылкой на WhatsApp',
}

const WHATSAPP_REASON_LABELS: Record<string, string> = {
  SESSION_OPEN: 'клиент недавно сам писал в WhatsApp',
  TEMPLATE_AVAILABLE: 'есть согласие клиента и одобренный шаблон',
  NO_RECORDED_CONSENT: 'WhatsApp пока недоступен для первого сообщения — нет согласия клиента',
  OPTED_OUT: 'клиент отказался от сообщений в WhatsApp',
  TEMPLATE_UNAVAILABLE: 'нет одобренного шаблона WhatsApp',
  NOT_CONFIGURED: 'WhatsApp не подключён',
  PROVIDER_UNAVAILABLE: 'WhatsApp сейчас недоступен',
  INVALID_DESTINATION: 'номер клиента не подходит для WhatsApp',
}

const SMS_REASON_LABELS: Record<string, string> = {
  NOT_CONFIGURED: 'SMS не подключены',
  PROVIDER_UNAVAILABLE: 'SMS сейчас недоступны',
  INVALID_DESTINATION: 'номер клиента не подходит для SMS',
  OPTED_OUT: 'клиент отказался от SMS',
  WHATSAPP_ENTRY_NOT_CONFIGURED: 'не указан номер WhatsApp для клиентов',
  BRIDGE_URL_NOT_CONFIGURED: 'не настроен адрес приложения для ссылок',
}

/** "WHATSAPP_NO_RECORDED_CONSENT" / "WHATSAPP_X|SMS_Y" → a readable explanation. */
export function recoveryReasonText(code: string | null): string | null {
  if (!code) return null
  const parts = code.split('|').map((part) => {
    if (part.startsWith('WHATSAPP_')) return WHATSAPP_REASON_LABELS[part.slice(9)] ?? 'WhatsApp недоступен'
    if (part.startsWith('SMS_')) return SMS_REASON_LABELS[part.slice(4)] ?? 'SMS недоступны'
    return null
  })
  const text = parts.filter((p): p is string => !!p)
  if (text.length === 0) return null
  const sentence = text.join('; ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}
