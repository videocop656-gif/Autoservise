import { Prisma, type UserRole } from '@prisma/client'
import type { AuthContext } from '../types/auth'
import { ApiError } from '../lib/errors'
import { requireRole } from '../middleware/requireRole'
import { hashPassword } from '../auth/password'
import { teamRepository, LastOwnerViolationError, isSerializationConflict } from '../repositories/teamRepository'
import type { CreateTeamMemberInput, UpdateTeamMemberProfileInput, ChangeTeamMemberRoleInput } from '../validation/team.schemas'

// All three roles can read (spec §2's permission matrix: List/View = YES
// for everyone) — mutation entry points each narrow this further below.
const ANY_STAFF_ROLE = ['owner', 'admin', 'manager'] as const
const MANAGING_ROLES = ['owner', 'admin'] as const

const LAST_OWNER_ERROR = () => new ApiError(409, 'LAST_OWNER_REQUIRED', 'At least one active owner is required')
// A genuine concurrent-write conflict (Postgres SERIALIZABLE aborted one of
// two racing transactions) — not necessarily a last-owner violation, so it
// gets its own honest message rather than borrowing LAST_OWNER_REQUIRED's.
const CONCURRENT_UPDATE_ERROR = () => new ApiError(409, 'CONCURRENT_UPDATE', 'This team member was updated concurrently — please try again')

async function resolveTarget(tenantId: string, id: string) {
  const target = await teamRepository.findById(tenantId, id)
  if (!target) {
    throw new ApiError(404, 'NOT_FOUND', 'Team member not found')
  }
  return target
}

/** Runs a repository call that may throw LastOwnerViolationError / a P2034 serialization conflict, translating both into the right safe ApiError. Never leaks a raw Prisma/transaction error. */
async function runOwnerGuarded<T>(fn: () => Promise<T | null>): Promise<T> {
  try {
    const result = await fn()
    if (!result) {
      throw new ApiError(404, 'NOT_FOUND', 'Team member not found')
    }
    return result
  } catch (err) {
    if (err instanceof LastOwnerViolationError) throw LAST_OWNER_ERROR()
    if (isSerializationConflict(err)) throw CONCURRENT_UPDATE_ERROR()
    throw err
  }
}

export async function listTeam(ctx: AuthContext) {
  requireRole(ctx, ...ANY_STAFF_ROLE)
  return teamRepository.list(ctx.tenant.id)
}

export async function getTeamMember(ctx: AuthContext, id: string) {
  requireRole(ctx, ...ANY_STAFF_ROLE)
  return resolveTarget(ctx.tenant.id, id)
}

/**
 * Spec §7/§2: owner can create owner/admin/manager; admin can create
 * admin/manager only; manager can create no one (blocked by the
 * `requireRole` below before this function's own role-vs-target-role check
 * ever runs).
 */
export async function createTeamMember(ctx: AuthContext, input: CreateTeamMemberInput) {
  requireRole(ctx, ...MANAGING_ROLES)

  if (input.role === 'owner' && ctx.user.role !== 'owner') {
    throw new ApiError(403, 'FORBIDDEN', 'Only an owner can create another owner')
  }

  const passwordHash = await hashPassword(input.password)

  try {
    const created = await teamRepository.create({
      tenantId: ctx.tenant.id,
      email: input.email,
      passwordHash,
      name: input.name,
      role: input.role,
    })
    return created
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ApiError(409, 'USER_EMAIL_ALREADY_EXISTS', 'A user with this email already exists')
    }
    throw err
  }
}

/**
 * Profile fields only (name/email) — the schema itself (team.schemas.ts)
 * never even parses role/isActive/tenantId/businessId/passwordHash out of
 * the request body, so there is no field for this function to accidentally
 * forward into Prisma even if it wanted to (spec §12).
 */
export async function updateTeamMemberProfile(ctx: AuthContext, id: string, input: UpdateTeamMemberProfileInput) {
  requireRole(ctx, ...ANY_STAFF_ROLE)
  const target = await resolveTarget(ctx.tenant.id, id)

  // Manager can never touch profile fields, not even its own (spec §12: "Manager не может изменять profile fields" — unconditional).
  if (ctx.user.role === 'manager') {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action')
  }
  // Admin can edit admin/manager profiles, including its own — but never an owner's, even with several owners in the business (spec §12).
  if (target.role === 'owner' && ctx.user.role !== 'owner') {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action')
  }

  try {
    const updated = await teamRepository.updateProfile(ctx.tenant.id, id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
    })
    if (!updated) {
      // Only reachable via a genuine race (the row was resolved above but vanished before the update — no delete flow exists for User today, so this is theoretical defense in depth).
      throw new ApiError(404, 'NOT_FOUND', 'Team member not found')
    }
    return updated
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ApiError(409, 'USER_EMAIL_ALREADY_EXISTS', 'A user with this email already exists')
    }
    throw err
  }
}

/**
 * Spec §10's full transition table, gated by the authoritative permission
 * matrix (spec §2): owner may set any role on any target (subject to the
 * last-owner rule below); admin may only move a target between admin and
 * manager (never touching an owner target, never granting owner); manager
 * is blocked entirely by `requireRole`. Self role-change is always
 * rejected regardless of role (spec §4).
 */
export async function changeTeamMemberRole(ctx: AuthContext, id: string, input: ChangeTeamMemberRoleInput) {
  requireRole(ctx, ...MANAGING_ROLES)

  // Spec §10's exact check order: resolve target (404 for a foreign/unknown
  // id) BEFORE the self-check (409) — a bad id should never reveal anything
  // about self-protection rules.
  const target = await resolveTarget(ctx.tenant.id, id)

  if (id === ctx.user.id) {
    throw new ApiError(409, 'CANNOT_CHANGE_OWN_ROLE', 'You cannot change your own role')
  }

  if (ctx.user.role === 'admin') {
    if (target.role === 'owner' || input.role === 'owner') {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action')
    }
  }

  // Idempotent no-op — same-role requests never touch the last-owner rule, matching appointmentService.ts's "from === to is always a no-op" convention.
  if (target.role === input.role) {
    return target
  }

  const requireOtherActiveOwner = target.role === 'owner' && input.role !== 'owner'
  return runOwnerGuarded(() => teamRepository.changeRole(ctx.tenant.id, id, input.role as UserRole, { requireOtherActiveOwner }))
}

/**
 * Spec §11: owner may activate anyone; admin may activate admin/manager
 * only, never an owner. Activation never creates a session and is never
 * blocked by the last-owner rule (it can only ever increase the active-
 * owner count, never decrease it).
 */
export async function activateTeamMember(ctx: AuthContext, id: string) {
  requireRole(ctx, ...MANAGING_ROLES)
  const target = await resolveTarget(ctx.tenant.id, id)

  if (target.role === 'owner' && ctx.user.role !== 'owner') {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action')
  }

  const updated = await teamRepository.activate(ctx.tenant.id, id)
  if (!updated) {
    throw new ApiError(404, 'NOT_FOUND', 'Team member not found')
  }
  return updated
}

/**
 * Spec §11's exact order: authenticate (route) → authorize → resolve
 * target → reject self → last-owner check (if target is an owner) → set
 * isActive=false + invalidate sessions, atomically (teamRepository.deactivate).
 */
export async function deactivateTeamMember(ctx: AuthContext, id: string) {
  requireRole(ctx, ...MANAGING_ROLES)

  // Same ordering rationale as changeTeamMemberRole above — resolve before self-check.
  const target = await resolveTarget(ctx.tenant.id, id)

  if (id === ctx.user.id) {
    throw new ApiError(409, 'CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own account')
  }

  if (target.role === 'owner' && ctx.user.role !== 'owner') {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action')
  }

  // Idempotent no-op — matches activate/deactivate conventions elsewhere (escalationService.ts's claim/resolve/cancel).
  if (!target.isActive) {
    return target
  }

  const requireOtherActiveOwner = target.role === 'owner'
  return runOwnerGuarded(() => teamRepository.deactivate(ctx.tenant.id, id, { requireOtherActiveOwner }))
}
