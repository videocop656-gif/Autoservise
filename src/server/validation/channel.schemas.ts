import { z } from 'zod'
import { ChannelType, ChannelConnectionStatus } from '@prisma/client'

export const channelIdParamSchema = z.string().uuid()

// Prompt 17 — the :messageId segment of POST
// /api/channels/:id/messages/:messageId/send. A separate, identically-typed
// export (rather than reusing channelIdParamSchema under an unrelated name)
// so each route param stays self-documenting at its call site.
export const channelDeliveryMessageIdParamSchema = z.string().uuid()

export const channelTypeFilterSchema = z.nativeEnum(ChannelType)
export const channelStatusFilterSchema = z.nativeEnum(ChannelConnectionStatus)

// A plain (non-nested) key/value bag only — matches aiLogService.ts's
// metadata convention (primitives only, no arrays/objects) so a config
// value can never smuggle a nested secret-shaped structure past this
// schema. The service layer (channelConnectionService.ts) additionally
// strips any key that even LOOKS secret-shaped (token/secret/key/password/
// credential/auth) as a second, independent line of defense — spec
// §"CONFIG" explicitly forbids storing a bot token/API key/OAuth token/
// refresh token/webhook secret/password here, in any form.
const channelConfigSchema = z.record(z.union([z.string().max(500), z.number(), z.boolean()])).optional()

export const createChannelConnectionSchema = z.object({
  type: z.nativeEnum(ChannelType),
  displayName: z.string().trim().min(1, 'Display name is required').max(120),
  externalAccountId: z.string().trim().min(1, 'External account id is required').max(200),
  config: channelConfigSchema,
})

// Deliberately never accepts tenantId/businessId/status (spec §"CHANNEL
// PATCH") — status changes only through activate.ts/deactivate.ts. A plain
// (non-`.strict()`) object, so any such field a client sends anyway is
// silently stripped by Zod's default unknown-key behavior, same
// convention as team.schemas.ts's profile-update schema.
export const updateChannelConnectionSchema = z
  .object({
    displayName: z.string().trim().min(1, 'Display name is required').max(120).optional(),
    externalAccountId: z.string().trim().min(1, 'External account id is required').max(200).optional(),
    config: channelConfigSchema,
  })
  .refine((data) => data.displayName !== undefined || data.externalAccountId !== undefined || data.config !== undefined, {
    message: 'At least one field must be provided',
  })

// Spec §"INBOUND ENDPOINT SECURITY": exactly the safe, channel-scoped
// fields a webhook payload may ever carry. No tenantId/businessId/
// customerId/conversationId field exists here to accept — the connection
// (from the URL's :id) is the only source of tenant/business, and
// customerId/conversationId are always server-resolved
// (channelConversationService.ts / channelCustomerService.ts).
export const inboundChannelPayloadSchema = z.object({
  externalMessageId: z.string().trim().min(1, 'externalMessageId is required').max(200),
  externalConversationId: z.string().trim().min(1, 'externalConversationId is required').max(200),
  externalCustomerId: z.string().trim().max(200).optional(),
  customerName: z.string().trim().max(200).optional(),
  customerPhone: z.string().trim().max(50).optional(),
  customerEmail: z.string().trim().toLowerCase().email('Invalid email').max(255).optional(),
  text: z.string().trim().min(1, 'text must not be empty').max(10000),
  sentAt: z.coerce.date(),
  metadata: z.record(z.unknown()).optional(),
})

export type CreateChannelConnectionInput = z.infer<typeof createChannelConnectionSchema>
export type UpdateChannelConnectionInput = z.infer<typeof updateChannelConnectionSchema>
export type InboundChannelPayload = z.infer<typeof inboundChannelPayloadSchema>
