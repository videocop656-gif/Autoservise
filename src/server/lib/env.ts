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
  // Deliberately NOT requireEnv(): an unconfigured key must never crash the
  // process. aiProviderFactory.ts falls back to the deterministic mock
  // provider when this is unset — see docs/AI_BEHAVIOR_CONTRACT.md and the
  // Prompt 09 final report for why that's the correct default here, rather
  // than a hard failure.
  get openAiApiKey(): string | undefined {
    const value = process.env.OPENAI_API_KEY
    return value && value.trim() !== '' ? value : undefined
  },
  get openAiModel(): string {
    return process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
  },
}

export const SESSION_COOKIE_NAME = 'session_token'

/** Sessions are valid for 30 days from creation; each authenticated request refreshes lastUsedAt. */
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000
