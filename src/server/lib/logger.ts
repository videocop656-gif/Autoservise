type LogFields = Record<string, unknown>

// Defense in depth: even if a caller accidentally passes a sensitive field,
// it gets redacted before it reaches stdout/stderr.
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'sessionToken',
  'tokenHash',
  'apiKey',
  'secret',
  'DATABASE_URL',
  'DIRECT_URL',
  'SESSION_SECRET',
  'cookie',
  'Cookie',
  'Set-Cookie',
])

function redact(fields: LogFields): LogFields {
  const safe: LogFields = {}
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = SENSITIVE_KEYS.has(key) ? '[REDACTED]' : value
  }
  return safe
}

function write(level: 'info' | 'warn' | 'error', event: string, fields: LogFields): void {
  const entry = { level, event, time: new Date().toISOString(), ...redact(fields) }
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  info: (event: string, fields: LogFields = {}) => write('info', event, fields),
  warn: (event: string, fields: LogFields = {}) => write('warn', event, fields),
  error: (event: string, fields: LogFields = {}) => write('error', event, fields),
}
