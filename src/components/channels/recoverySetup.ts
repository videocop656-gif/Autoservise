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

// MCR-8A — telephony (Kcell Virtual PBX) status for Settings. Secret-free:
// the CRM token never reaches the browser, numbers arrive masked.
export interface TelephonyStatusLike {
  provider: 'kcell' | 'mock' | 'none'
  mode: 'production' | 'mock' | 'off'
  tokenConfigured: boolean
  connection: 'ACTIVE' | 'DISABLED' | null
  connectedAt: string | null
  numbers: string[]
  missedCallEventsEnabled: boolean
  webhookUrl: string | null
}

export function telephonyView(s: TelephonyStatusLike) {
  const kcell = s.provider === 'kcell'
  return {
    provider: kcell ? 'Kcell Виртуальная АТС' : s.provider === 'mock' ? 'Тестовый (mock)' : 'не подключена',
    status: kcell
      ? s.connection === 'ACTIVE'
        ? s.tokenConfigured
          ? 'подключено'
          : 'ключ интеграции на сервере не найден'
        : s.tokenConfigured
          ? 'готово к подключению'
          : 'не настроено'
      : s.provider === 'mock'
        ? 'тестовый режим'
        : 'не настроено',
    ok: s.missedCallEventsEnabled && kcell,
    numbers: s.numbers.length > 0 ? s.numbers.join(', ') : 'номер мастерской не добавлен',
    events: s.missedCallEventsEnabled ? 'пропущенные звонки: включены' : 'пропущенные звонки: не поступают',
    canConnect: kcell && s.tokenConfigured && s.connection !== 'ACTIVE',
    canDisconnect: kcell && s.connection === 'ACTIVE',
  }
}
