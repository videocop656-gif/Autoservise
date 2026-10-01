import { z } from 'zod'
import { createCustomerSchema } from './customer.schemas'
import { createVehicleSchema } from './vehicle.schemas'

// Prompt 54 — customer & vehicle intake from a conversation. The customer and
// vehicle fields are the existing create schemas, unchanged; only the
// conversation-specific parts are new.

/**
 * POST /api/conversations/:id/customer
 *  - link:   attach an existing customer. `expectedCustomerId` is the
 *            customer the operator saw on the conversation (null = none) —
 *            the server only writes if it is still that, so a relink is
 *            always explicit and never overwrites someone else's newer change.
 *  - create: create a customer (existing rules) and link it, only while the
 *            conversation has no customer yet.
 */
export const conversationCustomerActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('link'),
    customerId: z.string().uuid('Invalid customer id'),
    expectedCustomerId: z.string().uuid('Invalid customer id').nullable(),
  }),
  z.object({
    action: z.literal('create'),
    customer: createCustomerSchema,
  }),
])

/** POST /api/conversations/:id/vehicles — the vehicle always belongs to the conversation's linked customer, never a client-sent one. */
export const conversationVehicleCreateSchema = createVehicleSchema.omit({ customerId: true })

export type ConversationCustomerActionInput = z.infer<typeof conversationCustomerActionSchema>
export type ConversationVehicleCreateInput = z.infer<typeof conversationVehicleCreateSchema>
