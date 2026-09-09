import type { LucideIcon } from 'lucide-react'
import { Globe, Send, Phone, MessageCircle, HelpCircle, UserRound } from 'lucide-react'

// ---------------------------------------------------------------------------
// Prompt 22 — Conversation Detail v1. Shared types/labels/helpers between
// the Conversations inbox (ConversationsSettingsPage.tsx) and the new
// ConversationDetailPanel.tsx — kept in one small, dependency-free module
// so both files read the exact same real backend shapes instead of two
// slightly-different local copies (spec §19: reuse, don't duplicate).
// Nothing here is a new architecture — it is the same DTO shapes already
// returned by the existing, unmodified backend.
// ---------------------------------------------------------------------------

export type ConversationChannel = 'MANUAL' | 'WEBSITE' | 'TELEGRAM' | 'WHATSAPP' | 'PHONE' | 'OTHER'
export type ConversationStatus = 'OPEN' | 'CLOSED'
export type MessageDirection = 'INBOUND' | 'OUTBOUND'
export type MessageSenderType = 'CUSTOMER' | 'STAFF' | 'SYSTEM'
export type EscalationStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED'
export type EscalationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
export type AiLogOperation =
  | 'AI_ANALYZE'
  | 'AI_TOOL_EXECUTION'
  | 'AI_ESCALATION_CREATE'
  | 'AI_ESCALATION_REUSE'
  | 'AI_ESCALATION_CLAIM'
  | 'AI_ESCALATION_RESOLVE'
  | 'AI_ESCALATION_CANCEL'
export type AiLogOutcome = 'SUCCESS' | 'ESCALATED' | 'REUSED' | 'FAILED' | 'REJECTED' | 'NO_ACTION'

type ChannelDeliveryStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED'

export interface ChannelDeliveryDto {
  id: string
  messageId: string
  channelConnectionId: string
  status: ChannelDeliveryStatus
  attemptCount: number
  externalMessageId: string | null
  lastAttemptAt: string | null
  sentAt: string | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface MessageDto {
  id: string
  conversationId: string
  direction: MessageDirection
  senderType: MessageSenderType
  content: string
  createdAt: string
  // Channel Operations & Delivery Foundation (Prompt 17) — present only once a send through a channel has been attempted for this message.
  delivery?: ChannelDeliveryDto
}

export interface ConversationDto {
  id: string
  customerId: string | null
  customerRequestId: string | null
  channel: ConversationChannel
  status: ConversationStatus
  subject: string | null
  startedAt: string
  lastMessageAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
  channelConnectionId: string | null
  customer?: { id: string; firstName: string; lastName: string | null } | null
  customerRequest?: { id: string; subject: string; status: string } | null
  messages?: MessageDto[]
}

/** Reference-data shape — same convention as the Dashboard/Appointments/Conversations reference-data lookups: fetched once (pageSize=100), resolved client-side by id. Only the fields this UI actually reads are declared. */
export interface CustomerRefDto {
  id: string
  firstName: string
  lastName: string | null
  phone: string
  email: string | null
}

export interface CustomerRequestRefDto {
  id: string
  customerId: string
  vehicleId: string | null
  serviceId: string | null
  status: CustomerRequestStatus
  subject: string
  description: string | null
  requestedDate: string | null
}

export interface VehicleRefDto {
  id: string
  customerId: string
  make: string
  model: string
  year: number | null
  licensePlate: string | null
  vin: string | null
}

export interface ServiceRefDto {
  id: string
  name: string
  priceFrom: string | null
  priceTo: string | null
  currency: string
}

export interface EscalationDto {
  id: string
  conversationId: string
  status: EscalationStatus
  priority: EscalationPriority
  reason: string
  summary: string | null
  createdAt: string
  resolvedAt: string | null
}

export interface AiLogDto {
  id: string
  operation: AiLogOperation
  outcome: AiLogOutcome
  intent: string | null
  needsHuman: boolean | null
  reason: string | null
  createdAt: string
}

export interface Paginated<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export const STATUS_LABELS: Record<ConversationStatus, string> = {
  OPEN: 'Открыт',
  CLOSED: 'Закрыт',
}

export const CHANNEL_LABELS: Record<ConversationChannel, string> = {
  MANUAL: 'Вручную',
  WEBSITE: 'Сайт',
  TELEGRAM: 'Telegram',
  WHATSAPP: 'WhatsApp',
  PHONE: 'Телефон',
  OTHER: 'Другое',
}

export const CHANNEL_ICONS: Record<ConversationChannel, LucideIcon> = {
  MANUAL: UserRound,
  WEBSITE: Globe,
  TELEGRAM: Send,
  WHATSAPP: MessageCircle,
  PHONE: Phone,
  OTHER: HelpCircle,
}

export const ESCALATION_STATUS_LABELS: Record<EscalationStatus, string> = {
  OPEN: 'Открыта',
  IN_PROGRESS: 'В работе',
  RESOLVED: 'Решена',
  CANCELLED: 'Отменена',
}

export type CustomerRequestStatus = 'NEW' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'QUALIFIED' | 'CONVERTED' | 'CLOSED' | 'CANCELLED'

export const REQUEST_STATUS_LABELS: Record<CustomerRequestStatus, string> = {
  NEW: 'Новая',
  IN_PROGRESS: 'В работе',
  WAITING_CUSTOMER: 'Ждём клиента',
  QUALIFIED: 'Квалифицирована',
  CONVERTED: 'Преобразована в запись',
  CLOSED: 'Закрыта',
  CANCELLED: 'Отменена',
}

const AI_OPERATION_LABELS: Record<AiLogOperation, string> = {
  AI_ANALYZE: 'Анализ обращения',
  AI_TOOL_EXECUTION: 'Действие AI',
  AI_ESCALATION_CREATE: 'AI создал эскалацию',
  AI_ESCALATION_REUSE: 'AI использовал текущую эскалацию',
  AI_ESCALATION_CLAIM: 'Эскалация взята в работу',
  AI_ESCALATION_RESOLVE: 'Эскалация решена',
  AI_ESCALATION_CANCEL: 'Эскалация отменена',
}

const AI_OUTCOME_LABELS: Record<AiLogOutcome, string> = {
  SUCCESS: 'успешно',
  ESCALATED: 'передано сотруднику',
  REUSED: 'без изменений',
  FAILED: 'ошибка',
  REJECTED: 'отклонено',
  NO_ACTION: 'без действия',
}

/** A short, honest AI-status line built only from the most recent real AiLog row for this conversation (spec §13: never invent a status the data doesn't support). */
export function aiLogSummary(log: AiLogDto): string {
  const base = AI_OPERATION_LABELS[log.operation] ?? log.operation
  const outcome = AI_OUTCOME_LABELS[log.outcome] ?? log.outcome
  return `${base} · ${outcome}`
}

export function attentionBadgeVariant(priority: EscalationPriority): 'destructive' | 'warning' | 'gold' {
  if (priority === 'URGENT') return 'destructive'
  if (priority === 'HIGH') return 'warning'
  return 'gold'
}

export function isActiveEscalation(status: EscalationStatus): boolean {
  return status === 'OPEN' || status === 'IN_PROGRESS'
}

export function customerName(customers: CustomerRefDto[], id: string | null): string {
  if (!id) return 'Неизвестный клиент'
  const c = customers.find((x) => x.id === id)
  return c ? `${c.firstName} ${c.lastName ?? ''}`.trim() : 'Неизвестный клиент'
}

export function vehicleLabel(vehicles: VehicleRefDto[], id: string | null): string | null {
  if (!id) return null
  const v = vehicles.find((x) => x.id === id)
  if (!v) return null
  const parts = [v.make, v.model, v.year ? `(${v.year})` : null].filter(Boolean)
  return parts.join(' ')
}

export function serviceName(services: ServiceRefDto[], id: string | null): string | null {
  if (!id) return null
  return services.find((x) => x.id === id)?.name ?? null
}

/** "5 мин назад" for very recent activity, "Сегодня/Вчера, HH:MM" for today/yesterday, else an absolute short date — one consistent format everywhere a conversation/message timestamp is shown (Prompt 21 spec §14, reused as-is for message timestamps in Prompt 22). */
export function formatActivity(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000)
  if (diffMin < 1) return 'только что'
  if (diffMin < 60) return `${diffMin} мин назад`

  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date)
  if (date.toDateString() === now.toDateString()) return `Сегодня, ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `Вчера, ${time}`
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}
