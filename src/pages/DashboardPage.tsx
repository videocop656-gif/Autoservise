import { useNavigate } from 'react-router-dom'
import { Wrench } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { useAuth } from '../context/AuthContext'

export default function DashboardPage() {
  const { user, tenant, business, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{business?.name ?? tenant?.name}</h1>
          <Button variant="outline" onClick={handleLogout}>
            Выйти
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Аккаунт</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Имя:</span> {user?.name}
            </p>
            <p>
              <span className="text-muted-foreground">Email:</span> {user?.email}
            </p>
            <p>
              <span className="text-muted-foreground">Роль:</span> {user?.role}
            </p>
            <p>
              <span className="text-muted-foreground">Tenant ID:</span> {tenant?.id}
            </p>
            <p>
              <span className="text-muted-foreground">Статус аккаунта:</span> {tenant?.status}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              AI-администратор
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Здесь появится AI-ресепшн: обработка заявок, запись на визит и напоминания. Функциональность будет
            добавлена на следующих этапах.
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
