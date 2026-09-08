import { z } from 'zod'
import { AiEscalationStatus, AiEscalationPriority } from '@prisma/client'

export const escalationIdParamSchema = z.string().uuid()
export const escalationStatusFilterSchema = z.nativeEnum(AiEscalationStatus)
export const escalationPriorityFilterSchema = z.nativeEnum(AiEscalationPriority)
