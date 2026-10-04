// ---------------------------------------------------------------------------
// MCR-6 — what Settings → Channels shows about missed-call recovery. Pure
// (unit-tested). The server's router decides for real, per call (consent,
// WhatsApp session, templates); this only explains the business-level setup.
// ---------------------------------------------------------------------------

export interface RecoveryChannelLike {
  type: string
  status: string
  config: Record<string, unknown> | null
  /** MCR-7B1 — a connected Twilio sender (masked) is itself the customer entry. */
  senderMasked?: string | null
}

export interface RecoverySetupView {
  whatsapp: { configured: boolean; label: string }
  sms: { configured: boolean; label: string }
  fallback: string
}

export function recoverySetupView(connections: RecoveryChannelLike[]): RecoverySetupView {
  const activeWhatsApp = connections.filter((c) => c.type === 'WHATSAPP' && c.status === 'ACTIVE')
  const entry = activeWhatsApp.some((c) => (typeof c.config?.customerEntryPhone === 'string' && c.config.customerEntryPhone !== '') || !!c.senderMasked)
  const sms = connections.some((c) => c.type === 'SMS' && c.status === 'ACTIVE')
  return {
    whatsapp: {
      configured: activeWhatsApp.length > 0 && entry,
      label: activeWhatsApp.length === 0 ? 'не подключён' : entry ? 'подключён' : 'подключён, но не указан номер WhatsApp для клиентов',
    },
    sms: { configured: sms, label: sms ? 'подключены' : 'не подключены' },
    fallback: 'Первое сообщение уходит в WhatsApp, когда это разрешено (клиент недавно писал сам или дал согласие). Иначе — SMS со ссылкой, которая открывает WhatsApp автосервиса.',
  }
}

// --- MCR-7A: SMS transport (server-wide) -----------------------------------

export interface SmsTransportStatusLike {
  provider: 'mobizon' | 'mock' | 'none'
  mode: 'production' | 'mock' | 'off'
  configured: boolean
  sender: string | null
  senderScope: 'SHARED_ACCOUNT'
  webhookConfigured: boolean
}

export interface SmsTransportView {
  provider: string
  mode: string
  status: string
  ok: boolean
  sender: string
  webhook: string | null
}

/** Never shows a key or secret (the API never returns them); never claims a workshop-branded sender. */
export function smsTransportView(s: SmsTransportStatusLike): SmsTransportView {
  const provider = s.provider === 'mobizon' ? 'Mobizon' : s.provider === 'mock' ? 'Тестовый (mock)' : 'не выбран'
  const mode = s.mode === 'production' ? 'рабочий' : s.mode === 'mock' ? 'тестовый, SMS не отправляются' : 'выключен'
  const sender =
    s.provider !== 'mobizon'
      ? '—'
      : s.sender
        ? `${s.sender} — общий отправитель AUTOSERVISE, не собственное имя вашего автосервиса`
        : 'отправитель по умолчанию аккаунта Mobizon (общий)'
  return {
    provider,
    mode,
    status: s.configured ? 'настроен' : 'не настроен',
    ok: s.configured,
    sender,
    webhook: s.provider === 'mobizon' ? (s.webhookConfigured ? 'отчёты о доставке подключены' : 'отчёты о доставке не подключены') : null,
  }
}

// --- MCR-7B1: WhatsApp transport (per business) -----------------------------

export interface WhatsAppTransportStatusLike {
  provider: 'twilio' | 'mock' | 'none'
  mode: 'production' | 'mock' | 'off'
  credentialsConfigured: boolean
  assignedSender: string | null
  recoveryTemplateConfigured: boolean
  webhooksConfigured: boolean
}

export function whatsappTransportView(s: WhatsAppTransportStatusLike) {
  return {
    provider: s.provider === 'twilio' ? 'Twilio' : s.provider === 'mock' ? 'Тестовый (mock)' : 'не выбран',
    mode: s.mode === 'production' ? 'рабочий' : s.mode === 'mock' ? 'тестовый, сообщения не отправляются' : 'выключен',
    status: s.provider === 'twilio' ? (s.credentialsConfigured ? 'подключён' : 'не настроен') : s.provider === 'mock' ? 'тестовый' : 'не настроен',
    ok: s.provider === 'twilio' && s.credentialsConfigured,
    sender: s.assignedSender ?? 'номер для вашего автосервиса не назначен',
    template: s.recoveryTemplateConfigured ? 'шаблон восстановления настроен' : 'шаблон восстановления не настроен — первое сообщение уходит SMS',
  }
}
