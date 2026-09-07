export class ApiClientError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string }
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
    throw new ApiClientError(res.status, body.error?.code ?? 'UNKNOWN_ERROR', body.error?.message ?? 'Something went wrong')
  }

  return data as T
}
