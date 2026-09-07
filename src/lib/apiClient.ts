export class ApiClientError extends Error {
  status: number
  code: string
  /** Per-field validation messages, when the server responded with VALIDATION_ERROR. */
  fieldErrors: Record<string, string[]>

  constructor(status: number, code: string, message: string, fieldErrors: Record<string, string[]> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: Record<string, string[]> }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const data: unknown = await res.json().catch(() => null)

  if (!res.ok) {
    const body = (data ?? {}) as ApiErrorBody
    throw new ApiClientError(
      res.status,
      body.error?.code ?? 'UNKNOWN_ERROR',
      body.error?.message ?? 'Something went wrong',
      body.error?.details ?? {}
    )
  }

  return data as T
}
