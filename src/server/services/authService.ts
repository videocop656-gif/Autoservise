import { Prisma } from '@prisma/client'
import { prisma } from '../db/prisma'
import { hashPassword, verifyPassword } from '../auth/password'
import { generateSessionToken, hashSessionToken } from '../auth/tokens'
import { SESSION_DURATION_MS } from '../lib/env'
import { ApiError } from '../lib/errors'
import { toSafeUser } from '../lib/safeUser'
import { DEFAULT_WORKING_HOURS } from '../domain/workingHoursDefaults'
import type { RegisterInput, LoginInput } from '../validation/auth.schemas'

// Precomputed once per process. Used to keep the timing of a "user not
// found" login attempt indistinguishable from a "wrong password" attempt,
// so failed logins can't be used to enumerate registered emails.
const DUMMY_PASSWORD_HASH_PROMISE = hashPassword('dummy-password-for-constant-time-comparison')

function newSessionExpiry(): Date {
  return new Date(Date.now() + SESSION_DURATION_MS)
}

export async function registerTenant(input: RegisterInput) {
  const passwordHash = await hashPassword(input.password)

  let created
  try {
    created = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: input.businessName, status: 'trial' },
      })
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: input.email,
          passwordHash,
          name: input.name,
          role: 'owner',
        },
      })
      const business = await tx.business.create({
        data: { tenantId: tenant.id, name: input.businessName },
      })
      await tx.businessWorkingHours.createMany({
        data: DEFAULT_WORKING_HOURS.map((day) => ({ businessId: business.id, ...day })),
      })
      return { tenant, user, business }
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists')
    }
    throw err
  }

  const token = generateSessionToken()
  const tokenHash = hashSessionToken(token)
  const expiresAt = newSessionExpiry()
  await prisma.session.create({ data: { userId: created.user.id, tokenHash, expiresAt } })

  return {
    token,
    expiresAt,
    user: toSafeUser(created.user),
    tenant: created.tenant,
    business: created.business,
  }
}

export async function loginUser(input: LoginInput) {
  const invalidCredentials = () => new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password')

  const user = await prisma.user.findUnique({ where: { email: input.email } })

  if (!user) {
    // Burn roughly the same amount of time as a real verify() call.
    await verifyPassword(await DUMMY_PASSWORD_HASH_PROMISE, input.password)
    throw invalidCredentials()
  }

  const valid = await verifyPassword(user.passwordHash, input.password)
  if (!valid) {
    throw invalidCredentials()
  }

  // Checked only after password verification — same principle as the
  // TENANT_INACTIVE check right below: you need the real password before
  // learning anything about the account's state (Team Management, Prompt 15
  // — a deactivated team member cannot start a new session).
  if (!user.isActive) {
    throw new ApiError(403, 'USER_INACTIVE', 'This account has been deactivated')
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId } })
  if (!tenant || tenant.status === 'suspended' || tenant.status === 'cancelled') {
    throw new ApiError(403, 'TENANT_INACTIVE', 'This account is not currently active')
  }

  const token = generateSessionToken()
  const tokenHash = hashSessionToken(token)
  const expiresAt = newSessionExpiry()
  await prisma.session.create({ data: { userId: user.id, tokenHash, expiresAt } })

  return { token, expiresAt, user: toSafeUser(user), tenant }
}

export async function logoutUser(token: string | undefined): Promise<void> {
  if (!token) return
  const tokenHash = hashSessionToken(token)
  await prisma.session.deleteMany({ where: { tokenHash } }).catch(() => {})
}
