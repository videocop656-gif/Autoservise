import { z } from 'zod'

export const registerSchema = z.object({
  businessName: z.string().trim().min(2, 'Business name is too short').max(120),
  name: z.string().trim().min(2, 'Name is too short').max(120),
  email: z.string().trim().toLowerCase().email('Invalid email').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
})

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email').max(255),
  password: z.string().min(1, 'Password is required').max(128),
})

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
