import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  Building2,
  Clock,
  Wrench,
  BookOpen,
  ScrollText,
  Car,
  UserPlus,
  History,
  ClipboardList,
  FileText,
  UsersRound,
} from 'lucide-react'
import { PageContainer } from '../components/layout/PageContainer'
import { PageHeader } from '../components/layout/PageHeader'
import { Card, CardDescription, CardHeader, CardTitle } from '../components/ui/card'

interface SettingsLink {
  to: string
  label: string
  description: string
  icon: LucideIcon
}

interface SettingsGroup {
  title: string
  items: SettingsLink[]
}

// Every link here is a real, already-working page (Prompts 02–15) — this
// hub does not invent any new functionality, it only gives the remaining
// /settings/* pages (the ones not promoted to a primary sidebar section in
// Prompt 19) a real place to be discovered from.
const GROUPS: SettingsGroup[] = [
  {
    title: 'Автосервис',
    items: [
      { to: '/settings/business', label: 'Профиль автосервиса', description: 'Название, контакты, часовой пояс, валюта', icon: Building2 },
      { to: '/settings/hours', label: 'Часы работы', description: 'Расписание работы по дням недели', icon: Clock },
      { to: '/settings/services', label: 'Услуги', description: 'Каталог услуг и цены', icon: Wrench },
      { to: '/settings/knowledge', label: 'База знаний', description: 'Справочная информация для AI', icon: BookOpen },
      { to: '/settings/rules', label: 'Бизнес-правила', description: 'Правила, которые учитывает AI', icon: ScrollText },
    ],
  },
  {
    title: 'CRM',
    items: [
      { to: '/settings/vehicles', label: 'Автомобили', description: 'Автомобили клиентов', icon: Car },
      { to: '/settings/leads', label: 'Лиды', description: 'Потенциальные клиенты', icon: UserPlus },
      { to: '/settings/service-history', label: 'История обслуживания', description: 'Выполненные работы', icon: History },
      { to: '/settings/customer-requests', label: 'Заявки клиентов', description: 'Входящие заявки и их статус', icon: ClipboardList },
    ],
  },
  {
    title: 'Команда и AI',
    items: [
      { to: '/settings/team', label: 'Команда', description: 'Сотрудники и роли доступа', icon: UsersRound },
      { to: '/settings/ai-logs', label: 'AI Logs', description: 'Технический журнал действий AI', icon: FileText },
    ],
  },
]

export default function SettingsHubPage() {
  return (
    <PageContainer className="max-w-5xl space-y-8">
      <PageHeader title="Настройки" subtitle="Business and account settings" />
      {GROUPS.map((group) => (
        <section key={group.title} className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">{group.title}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((item) => (
              <Link key={item.to} to={item.to}>
                <Card className="h-full transition-colors hover:border-primary/50">
                  <CardHeader className="flex-row items-center gap-3 space-y-0">
                    <item.icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0">
                      <CardTitle className="text-base">{item.label}</CardTitle>
                      <CardDescription className="truncate">{item.description}</CardDescription>
                    </div>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </PageContainer>
  )
}
