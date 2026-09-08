import type {
  Business,
  BusinessWorkingHours,
  Service,
  KnowledgeItem,
  BusinessRule,
  Customer,
  Vehicle,
  Lead,
  Appointment,
  ServiceRecord,
  CustomerRequest,
  CustomerRequestStatusHistory,
  Conversation,
  Message,
  AiEscalation,
} from '@prisma/client'

/**
 * Never return raw Prisma objects to the client. These DTOs are the single
 * place that decides what a Business/WorkingHours/Service looks like over
 * the wire — in particular, converting Decimal money fields to fixed-point
 * strings and omitting internal-only fields (tenantId/businessId, which the
 * client never needs since the server always resolves them from the
 * session).
 */

export interface BusinessDto {
  id: string
  name: string
  description: string | null
  phone: string | null
  email: string | null
  address: string | null
  timezone: string
  website: string | null
  currency: string
  createdAt: Date
  updatedAt: Date
}

export function toBusinessDto(business: Business): BusinessDto {
  return {
    id: business.id,
    name: business.name,
    description: business.description,
    phone: business.phone,
    email: business.email,
    address: business.address,
    timezone: business.timezone,
    website: business.website,
    currency: business.currency,
    createdAt: business.createdAt,
    updatedAt: business.updatedAt,
  }
}

export interface WorkingHourDto {
  dayOfWeek: BusinessWorkingHours['dayOfWeek']
  isOpen: boolean
  openTime: string | null
  closeTime: string | null
}

export function toWorkingHourDto(hours: BusinessWorkingHours): WorkingHourDto {
  return {
    dayOfWeek: hours.dayOfWeek,
    isOpen: hours.isOpen,
    openTime: hours.openTime,
    closeTime: hours.closeTime,
  }
}

export interface ServiceDto {
  id: string
  name: string
  description: string | null
  priceFrom: string | null
  priceTo: string | null
  currency: string
  durationMinutes: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export function toServiceDto(service: Service): ServiceDto {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    priceFrom: service.priceFrom ? service.priceFrom.toFixed(2) : null,
    priceTo: service.priceTo ? service.priceTo.toFixed(2) : null,
    currency: service.currency,
    durationMinutes: service.durationMinutes,
    isActive: service.isActive,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  }
}

export interface KnowledgeItemDto {
  id: string
  title: string
  content: string
  category: KnowledgeItem['category']
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export function toKnowledgeItemDto(item: KnowledgeItem): KnowledgeItemDto {
  return {
    id: item.id,
    title: item.title,
    content: item.content,
    category: item.category,
    isActive: item.isActive,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

export interface BusinessRuleDto {
  id: string
  name: string
  description: string
  category: BusinessRule['category']
  priority: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export function toBusinessRuleDto(rule: BusinessRule): BusinessRuleDto {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    category: rule.category,
    priority: rule.priority,
    isActive: rule.isActive,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  }
}

export interface CustomerDto {
  id: string
  firstName: string
  lastName: string | null
  phone: string
  email: string | null
  notes: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export function toCustomerDto(customer: Customer): CustomerDto {
  return {
    id: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone,
    email: customer.email,
    notes: customer.notes,
    isActive: customer.isActive,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  }
}

export interface VehicleDto {
  id: string
  customerId: string
  make: string
  model: string
  year: number | null
  licensePlate: string | null
  vin: string | null
  mileage: number | null
  notes: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export function toVehicleDto(vehicle: Vehicle): VehicleDto {
  return {
    id: vehicle.id,
    customerId: vehicle.customerId,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    licensePlate: vehicle.licensePlate,
    vin: vehicle.vin,
    mileage: vehicle.mileage,
    notes: vehicle.notes,
    isActive: vehicle.isActive,
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
  }
}

export interface LeadDto {
  id: string
  customerId: string
  vehicleId: string | null
  serviceId: string | null
  status: Lead['status']
  source: Lead['source']
  subject: string
  description: string | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

export function toLeadDto(lead: Lead): LeadDto {
  return {
    id: lead.id,
    customerId: lead.customerId,
    vehicleId: lead.vehicleId,
    serviceId: lead.serviceId,
    status: lead.status,
    source: lead.source,
    subject: lead.subject,
    description: lead.description,
    notes: lead.notes,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  }
}

export interface AppointmentDto {
  id: string
  customerId: string
  vehicleId: string
  serviceId: string
  startAt: Date
  endAt: Date
  status: Appointment['status']
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

export function toAppointmentDto(appointment: Appointment): AppointmentDto {
  return {
    id: appointment.id,
    customerId: appointment.customerId,
    vehicleId: appointment.vehicleId,
    serviceId: appointment.serviceId,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    status: appointment.status,
    notes: appointment.notes,
    createdAt: appointment.createdAt,
    updatedAt: appointment.updatedAt,
  }
}

export interface ServiceRecordDto {
  id: string
  customerId: string
  vehicleId: string
  serviceId: string
  appointmentId: string | null
  performedAt: Date
  mileage: number | null
  totalPrice: string
  currency: string
  workDescription: string
  partsDescription: string | null
  recommendations: string | null
  notes: string | null
  isArchived: boolean
  createdAt: Date
  updatedAt: Date
}

export function toServiceRecordDto(record: ServiceRecord): ServiceRecordDto {
  return {
    id: record.id,
    customerId: record.customerId,
    vehicleId: record.vehicleId,
    serviceId: record.serviceId,
    appointmentId: record.appointmentId,
    performedAt: record.performedAt,
    mileage: record.mileage,
    totalPrice: record.totalPrice.toFixed(2),
    currency: record.currency,
    workDescription: record.workDescription,
    partsDescription: record.partsDescription,
    recommendations: record.recommendations,
    notes: record.notes,
    isArchived: record.isArchived,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export interface CustomerRequestStatusHistoryDto {
  fromStatus: CustomerRequestStatusHistory['fromStatus']
  toStatus: CustomerRequestStatusHistory['toStatus']
  // The raw user id is included for consistency with every other DTO
  // (which always return foreign ids, e.g. customerId/vehicleId) — it's not
  // sensitive, just an internal reference. changedByUserName is an added
  // display convenience specific to this history trail: unlike Customer/
  // Vehicle/Service, there is no /api/users endpoint the frontend could use
  // to resolve a user id to a name on its own.
  changedByUserId: string | null
  changedByUserName: string | null
  createdAt: Date
}

export interface CustomerRequestDto {
  id: string
  customerId: string
  vehicleId: string | null
  serviceId: string | null
  appointmentId: string | null
  source: CustomerRequest['source']
  status: CustomerRequest['status']
  subject: string
  description: string | null
  requestedDate: Date | null
  requestedTimeFrom: string | null
  requestedTimeTo: string | null
  notes: string | null
  createdAt: Date
  updatedAt: Date
  // Only present on the single-GET response (spec §22); list items omit it.
  statusHistory?: CustomerRequestStatusHistoryDto[]
}

type CustomerRequestWithOptionalHistory = CustomerRequest & {
  statusHistory?: (CustomerRequestStatusHistory & { changedByUser?: { name: string } | null })[]
}

export function toCustomerRequestDto(request: CustomerRequestWithOptionalHistory): CustomerRequestDto {
  return {
    id: request.id,
    customerId: request.customerId,
    vehicleId: request.vehicleId,
    serviceId: request.serviceId,
    appointmentId: request.appointmentId,
    source: request.source,
    status: request.status,
    subject: request.subject,
    description: request.description,
    requestedDate: request.requestedDate,
    requestedTimeFrom: request.requestedTimeFrom,
    requestedTimeTo: request.requestedTimeTo,
    notes: request.notes,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    ...(request.statusHistory
      ? {
          statusHistory: request.statusHistory.map((h) => ({
            fromStatus: h.fromStatus,
            toStatus: h.toStatus,
            changedByUserId: h.changedByUserId,
            changedByUserName: h.changedByUser?.name ?? null,
            createdAt: h.createdAt,
          })),
        }
      : {}),
  }
}

export interface MessageDto {
  id: string
  conversationId: string
  direction: Message['direction']
  senderType: Message['senderType']
  content: string
  createdAt: Date
}

export function toMessageDto(message: Message): MessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    direction: message.direction,
    senderType: message.senderType,
    content: message.content,
    createdAt: message.createdAt,
  }
}

export interface ConversationDto {
  id: string
  customerId: string | null
  customerRequestId: string | null
  channel: Conversation['channel']
  status: Conversation['status']
  subject: string | null
  startedAt: Date
  lastMessageAt: Date | null
  closedAt: Date | null
  createdAt: Date
  updatedAt: Date
  // Only present on the single-GET response (spec §24); list items omit
  // both the summaries and the messages array.
  customer?: { id: string; firstName: string; lastName: string | null } | null
  customerRequest?: { id: string; subject: string; status: CustomerRequest['status'] } | null
  messages?: MessageDto[]
}

type ConversationWithOptionalDetail = Conversation & {
  customer?: { id: string; firstName: string; lastName: string | null } | null
  customerRequest?: { id: string; subject: string; status: CustomerRequest['status'] } | null
  messages?: Message[]
}

export function toConversationDto(conversation: ConversationWithOptionalDetail): ConversationDto {
  return {
    id: conversation.id,
    customerId: conversation.customerId,
    customerRequestId: conversation.customerRequestId,
    channel: conversation.channel,
    status: conversation.status,
    subject: conversation.subject,
    startedAt: conversation.startedAt,
    lastMessageAt: conversation.lastMessageAt,
    closedAt: conversation.closedAt,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    ...('customer' in conversation ? { customer: conversation.customer ?? null } : {}),
    ...('customerRequest' in conversation ? { customerRequest: conversation.customerRequest ?? null } : {}),
    ...(conversation.messages ? { messages: conversation.messages.map(toMessageDto) } : {}),
  }
}

export interface AiEscalationDto {
  id: string
  conversationId: string
  customerId: string | null
  status: AiEscalation['status']
  priority: AiEscalation['priority']
  reason: string
  summary: string | null
  assignedUserId: string | null
  createdAt: Date
  updatedAt: Date
  resolvedAt: Date | null
  // Only present on the single-GET response — list items omit these, same
  // convention as ConversationDto's customer/customerRequest summaries.
  customer?: { id: string; firstName: string; lastName: string | null } | null
  assignedUser?: { id: string; name: string } | null
  conversation?: { id: string; subject: string | null; status: Conversation['status']; channel: Conversation['channel'] } | null
}

type AiEscalationWithOptionalDetail = AiEscalation & {
  customer?: { id: string; firstName: string; lastName: string | null } | null
  assignedUser?: { id: string; name: string } | null
  conversation?: { id: string; subject: string | null; status: Conversation['status']; channel: Conversation['channel'] } | null
}

// Never includes tenantId/businessId/activeConversationId (the last is a
// purely internal idempotency mechanism — see prisma/schema.prisma's
// AiEscalation.activeConversationId comment — never meaningful to a client).
export function toAiEscalationDto(escalation: AiEscalationWithOptionalDetail): AiEscalationDto {
  return {
    id: escalation.id,
    conversationId: escalation.conversationId,
    customerId: escalation.customerId,
    status: escalation.status,
    priority: escalation.priority,
    reason: escalation.reason,
    summary: escalation.summary,
    assignedUserId: escalation.assignedUserId,
    createdAt: escalation.createdAt,
    updatedAt: escalation.updatedAt,
    resolvedAt: escalation.resolvedAt,
    ...('customer' in escalation ? { customer: escalation.customer ?? null } : {}),
    ...('assignedUser' in escalation ? { assignedUser: escalation.assignedUser ?? null } : {}),
    ...('conversation' in escalation ? { conversation: escalation.conversation ?? null } : {}),
  }
}
