// ---------------------------------------------------------------------------
// MCR-6 — what Settings → Channels shows about missed-call recovery. Pure
// (unit-tested). The server's router decides for real, per call (consent,
// WhatsApp session, templates); this only explains the business-level setup.
// ---------------------------------------------------------------------------

export interface RecoveryChannelLike {
  type: string
  status: string
  config: Record<string, unknown> | null
}

export interface RecoverySetupView {
  whatsapp: { configured: boolean; label: string }
  sms: { configured: boolean; label: string }
  fallback: string
}

export function recoverySetupView(connections: RecoveryChannelLike[]): RecoverySetupView {
  const activeWhatsApp = connections.filter((c) => c.type === 'WHATSAPP' && c.status === 'ACTIVE')
  const entry = activeWhatsApp.some((c) => typeof c.config?.customerEntryPhone === 'string' && c.config.customerEntryPhone !== '')
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
