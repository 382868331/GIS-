export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ??
  'http://127.0.0.1:8000'

export interface DemoData {
  postgresql: {
    id: number
    name: string
    created_at: string
  }
  redis: {
    key: string
    value: string
  }
}

export interface User {
  id: string
  email: string
  is_active: boolean
  is_superuser: boolean
  is_verified: boolean
}

interface RequestOptions extends RequestInit {
  skipUnauthorizedHandler?: boolean
  timeoutMs?: number
}

type UnauthorizedHandler = () => void

let unauthorizedHandler: UnauthorizedHandler | null = null

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  unauthorizedHandler = handler
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { skipUnauthorizedHandler = false, timeoutMs, ...fetchOptions } = options
  const timeoutController = timeoutMs ? new AbortController() : null
  const timeoutId = timeoutController
    ? window.setTimeout(() => timeoutController.abort(new DOMException('请求超时', 'TimeoutError')), timeoutMs)
    : null
  const signals = [fetchOptions.signal, timeoutController?.signal].filter(
    (signal): signal is AbortSignal => Boolean(signal),
  )

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...fetchOptions,
      signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...fetchOptions.headers,
      },
    })
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId)
  }

  if (response.status === 401 && !skipUnauthorizedHandler) {
    unauthorizedHandler?.()
  }

  if (!response.ok) {
    let message = `请求失败：HTTP ${response.status}`

    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') {
        message = translateApiError(body.detail)
      }
    } catch {
      // Keep the HTTP status fallback when the response is not JSON.
    }

    throw new ApiError(message, response.status)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

function translateApiError(detail: string): string {
  const messages: Record<string, string> = {
    LOGIN_BAD_CREDENTIALS: '邮箱或密码错误',
    LOGIN_USER_NOT_VERIFIED: '用户尚未通过验证',
    REGISTER_USER_ALREADY_EXISTS: '该邮箱已经注册',
    REGISTER_INVALID_PASSWORD: '密码不符合要求',
    Unauthorized: '请先登录',
  }

  return messages[detail] ?? detail
}

export function getDemoData(): Promise<DemoData> {
  return apiRequest<DemoData>('/api/demo-data')
}

export function getCurrentUser(): Promise<User> {
  return apiRequest<User>('/api/users/me', {
    skipUnauthorizedHandler: true,
    timeoutMs: 8_000,
  })
}

export function register(email: string, password: string): Promise<User> {
  return apiRequest<User>('/api/auth/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
    skipUnauthorizedHandler: true,
  })
}

export function prepareDemoAccount(
  email: string,
  password: string,
): Promise<{ action: 'registered' | 'login' | 'password_reset' }> {
  return apiRequest('/api/auth/demo-prepare', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
    skipUnauthorizedHandler: true,
  })
}

export function login(email: string, password: string): Promise<void> {
  const body = new URLSearchParams({
    username: email,
    password,
  })

  return apiRequest<void>('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    skipUnauthorizedHandler: true,
  })
}

export function logout(): Promise<void> {
  return apiRequest<void>('/api/auth/logout', {
    method: 'POST',
    skipUnauthorizedHandler: true,
  })
}
