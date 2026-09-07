import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { apiFetch } from '../lib/apiClient'

type Role = 'owner' | 'admin' | 'manager'
type TenantStatus = 'trial' | 'active' | 'suspended' | 'cancelled'

export interface AuthUser {
  id: string
  tenantId: string
  email: string
  name: string
  role: Role
}

export interface AuthTenant {
  id: string
  name: string
  status: TenantStatus
}

export interface AuthBusiness {
  id: string
  name: string
  description: string | null
  phone: string | null
  email: string | null
  address: string | null
  timezone: string
  website: string | null
  currency: string
}

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  tenant: AuthTenant | null
  business: AuthBusiness | null
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [tenant, setTenant] = useState<AuthTenant | null>(null)
  const [business, setBusiness] = useState<AuthBusiness | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: AuthUser; tenant: AuthTenant; business: AuthBusiness | null }>(
        '/api/auth/me'
      )
      setUser(data.user)
      setTenant(data.tenant)
      setBusiness(data.business)
      setStatus('authenticated')
    } catch {
      setUser(null)
      setTenant(null)
      setBusiness(null)
      setStatus('unauthenticated')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const logout = useCallback(async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    setUser(null)
    setTenant(null)
    setBusiness(null)
    setStatus('unauthenticated')
  }, [])

  return (
    <AuthContext.Provider value={{ status, user, tenant, business, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
