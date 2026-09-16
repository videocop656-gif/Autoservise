import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { apiFetch, ApiClientError } from '../lib/apiClient'
import { useAuth } from '../context/AuthContext'
import { AppLaunchScreen } from '../components/launch/AppLaunchScreen'

// sessionStorage (not localStorage): the cinematic intro should reappear on
// a genuinely new browser session, but never repeat on every reload/return
// within the same tab session (Prompt 45 spec — "показать launch experience
// при первом открытии приложения / новой сессии", "не превращать splash
// screen в обязательную долгую заставку").
const LAUNCH_SEEN_KEY = 'autoservise:launch-seen'

function hasSeenLaunchThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(LAUNCH_SEEN_KEY) === 'true'
  } catch {
    // sessionStorage unavailable (private-mode/blocked storage) — fail open
    // to the plain login form rather than risk getting stuck on the intro.
    return true
  }
}

function markLaunchSeenThisSession(): void {
  try {
    window.sessionStorage.setItem(LAUNCH_SEEN_KEY, 'true')
  } catch {
    /* best-effort only — nothing else to do if storage is unavailable. */
  }
}

export default function LoginPage() {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [showLaunch, setShowLaunch] = useState(() => !hasSeenLaunchThisSession())
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      await refresh()
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Не удалось выполнить вход')
    } finally {
      setLoading(false)
    }
  }

  if (showLaunch) {
    return (
      <AppLaunchScreen
        brandName="AUTOSERVISE"
        brandTagline="Система готова к работе с вашим автосервисом"
        ctaLabel="Начать работу"
        ctaAction={() => {
          markLaunchSeenThisSession()
          setShowLaunch(false)
        }}
      />
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Вход</CardTitle>
          <CardDescription>Войдите в аккаунт вашего автосервиса</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Вход...' : 'Войти'}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Нет аккаунта?{' '}
            <Link to="/register" className="font-medium text-primary underline-offset-4 hover:underline">
              Создать аккаунт
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
