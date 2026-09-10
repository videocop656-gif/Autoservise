import type { LucideIcon } from 'lucide-react'
import { LayoutDashboard, MessageSquare, Users, CalendarDays, ClipboardList, Bot, UserRoundCheck, Radio, Settings } from 'lucide-react'

/**
 * The single source of truth for the primary product navigation (Prompt 19
 * spec §10) — Sidebar, MobileNav, and Header's page-title lookup all read
 * from this one file. Icons are lucide-react (already an installed
 * dependency), never emoji (spec §10).
 */
export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/conversations', label: 'Диалоги', icon: MessageSquare },
  { to: '/clients', label: 'Клиенты', icon: Users },
  { to: '/requests', label: 'Заявки', icon: ClipboardList },
  { to: '/appointments', label: 'Записи', icon: CalendarDays },
  { to: '/ai-admin', label: 'AI-администратор', icon: Bot },
  { to: '/escalations', label: 'Передача сотруднику', icon: UserRoundCheck },
  { to: '/channels', label: 'Каналы', icon: Radio },
]

/** Shown separately, below a divider (spec §10/§13). */
export const BOTTOM_NAV_ITEMS: NavItem[] = [{ to: '/settings', label: 'Настройки', icon: Settings }]

/**
 * Header's "current page" title (spec §12). Covers every real route in the
 * app, including the settings sub-pages that are not primary nav items but
 * remain fully reachable (via the Settings hub) — see App.tsx. Falls back
 * to the product name for anything unmapped (should not normally happen).
 */
const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/conversations': 'Диалоги',
  '/clients': 'Клиенты',
  '/requests': 'Заявки',
  '/appointments': 'Записи',
  '/ai-admin': 'AI-администратор',
  '/escalations': 'Передача сотруднику',
  '/channels': 'Каналы',
  '/settings': 'Настройки',
  '/settings/business': 'Профиль автосервиса',
  '/settings/hours': 'Часы работы',
  '/settings/services': 'Услуги',
  '/settings/knowledge': 'База знаний',
  '/settings/rules': 'Бизнес-правила',
  '/settings/vehicles': 'Автомобили',
  '/settings/leads': 'Лиды',
  '/settings/service-history': 'История обслуживания',
  '/settings/ai-logs': 'AI Logs',
  '/settings/team': 'Команда',
}

export function getPageTitle(pathname: string): string {
  return PAGE_TITLES[pathname] ?? 'AI Администратор'
}
