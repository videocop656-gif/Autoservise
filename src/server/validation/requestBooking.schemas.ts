import { z } from 'zod'

// Prompt 56 — POST /api/customer-requests/:id/booking. The browser sends
// only its choice: the start of a slot, plus the request version it saw.
// Customer, vehicle, service and the end time come from the persisted
// request and its service — `.strict()` rejects any attempt to send ids.
const isoDateTime = z.string().datetime({ offset: true, message: 'Invalid ISO 8601 datetime' }).transform((v) => new Date(v))

export const confirmRequestBookingSchema = z
  .object({
    startAt: isoDateTime,
    expectedRequestUpdatedAt: isoDateTime,
  })
  .strict()

export type ConfirmRequestBookingBody = z.infer<typeof confirmRequestBookingSchema>
