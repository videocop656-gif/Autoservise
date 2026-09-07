function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export const env = {
  get databaseUrl(): string {
    return requireEnv('DATABASE_URL')
  },
  get sessionSecret(): string {
    return requireEnv('SESSION_SECRET')
  },
  get nodeEnv(): string {
    return process.env.NODE_ENV ?? 'development'
  },
  get appUrl(): string {
    return process.env.APP_URL ?? 'http://localhost:5173'
  },
  get isProduction(): boolean {
    return this.nodeEnv === 'production'
  },
}

export const SESSION_COOKIE_NAME = 'session_token'

/** Sessions are valid for 30 days from creation; each authenticated request refreshes lastUsedAt. */
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000
