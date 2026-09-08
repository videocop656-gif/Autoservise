import { z } from 'zod'
import { AiLogOperation, AiLogOutcome } from '@prisma/client'

export const aiLogIdParamSchema = z.string().uuid()
export const aiLogOperationFilterSchema = z.nativeEnum(AiLogOperation)
export const aiLogOutcomeFilterSchema = z.nativeEnum(AiLogOutcome)
