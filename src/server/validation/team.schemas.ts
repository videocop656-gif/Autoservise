import { z } from 'zod'
import { UserRole } from '@prisma/client'

// Same bounds as auth.schemas.ts's registerSchema — team members are
// created through a different endpoint but must satisfy the identical
// password/email/name policy already enforced at registration (spec §7:
// "не создавать отдельную несовместимую policy").
const nameSchema = z.string().trim().min(2, 'Name is too short').max(120)
const emailSchema = z.string().trim().toLowerCase().email('Invalid email').max(255)
const passwordSchema = z.string().min(8, 'Password must be at least 8 characters').max(128)

export const teamIdParamSchema = z.string().uuid()

export const createTeamMemberSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  role: z.nativeEnum(UserRole),
})

// Deliberately a plain (non-`.strict()`) object: only `name`/`email` are
// declared, so role/isActive/tenantId/businessId/passwordHash sent by a
// client are silently stripped by Zod's default unknown-key behavior
// before this object ever reaches teamService.ts/Prisma — the same
// "unknown keys never survive validation" convention already used for the
// AI tool schemas (see tools/schemas.ts). Authorization state can only
// ever change through the dedicated role/activate/deactivate endpoints.
export const updateTeamMemberProfileSchema = z
  .object({
    name: nameSchema.optional(),
    email: emailSchema.optional(),
  })
  .refine((data) => data.name !== undefined || data.email !== undefined, {
    message: 'At least one field must be provided',
  })

export const changeTeamMemberRoleSchema = z.object({
  role: z.nativeEnum(UserRole),
})

export type CreateTeamMemberInput = z.infer<typeof createTeamMemberSchema>
export type UpdateTeamMemberProfileInput = z.infer<typeof updateTeamMemberProfileSchema>
export type ChangeTeamMemberRoleInput = z.infer<typeof changeTeamMemberRoleSchema>
