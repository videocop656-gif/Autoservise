import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import SettingsHubPage from './pages/SettingsHubPage'
import BusinessSettingsPage from './pages/settings/BusinessSettingsPage'
import HoursSettingsPage from './pages/settings/HoursSettingsPage'
import ServicesSettingsPage from './pages/settings/ServicesSettingsPage'
import KnowledgeSettingsPage from './pages/settings/KnowledgeSettingsPage'
import RulesSettingsPage from './pages/settings/RulesSettingsPage'
import CustomersSettingsPage from './pages/settings/CustomersSettingsPage'
import VehiclesSettingsPage from './pages/settings/VehiclesSettingsPage'
import LeadsSettingsPage from './pages/settings/LeadsSettingsPage'
import AppointmentsSettingsPage from './pages/settings/AppointmentsSettingsPage'
import ServiceHistorySettingsPage from './pages/settings/ServiceHistorySettingsPage'
import CustomerRequestsSettingsPage from './pages/settings/CustomerRequestsSettingsPage'
import ConversationsSettingsPage from './pages/settings/ConversationsSettingsPage'
import AiSettingsPage from './pages/settings/AiSettingsPage'
import EscalationsSettingsPage from './pages/settings/EscalationsSettingsPage'
import AiLogsSettingsPage from './pages/settings/AiLogsSettingsPage'
import TeamSettingsPage from './pages/settings/TeamSettingsPage'
import ChannelsSettingsPage from './pages/settings/ChannelsSettingsPage'
import ProtectedRoute from './components/ProtectedRoute'
import AppShell from './components/layout/AppShell'

// Route map (Prompt 19 — Frontend Foundation + App Shell):
//
// The new primary sidebar sections (spec §14) lead directly to the real,
// already-working pages built across Prompts 02–18 — /clients renders the
// exact same functionality that used to live at /settings/customers, etc.
// The old /settings/* URLs for those five redirect to their new home
// (single source of truth, never two parallel copies of the same feature).
// Every other existing /settings/* page (business/hours/services/knowledge/
// rules/vehicles/leads/service-history/customer-requests/ai-logs/team)
// keeps its exact URL — SettingsHubPage links out to all of them. See the
// Final Report's "Frontend architecture" section for the full reasoning.
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/conversations" element={<ConversationsSettingsPage />} />
        <Route path="/clients" element={<CustomersSettingsPage />} />
        <Route path="/appointments" element={<AppointmentsSettingsPage />} />
        <Route path="/ai-admin" element={<AiSettingsPage />} />
        <Route path="/escalations" element={<EscalationsSettingsPage />} />
        <Route path="/channels" element={<ChannelsSettingsPage />} />

        <Route path="/settings" element={<SettingsHubPage />} />
        <Route path="/settings/business" element={<BusinessSettingsPage />} />
        <Route path="/settings/hours" element={<HoursSettingsPage />} />
        <Route path="/settings/services" element={<ServicesSettingsPage />} />
        <Route path="/settings/knowledge" element={<KnowledgeSettingsPage />} />
        <Route path="/settings/rules" element={<RulesSettingsPage />} />
        <Route path="/settings/vehicles" element={<VehiclesSettingsPage />} />
        <Route path="/settings/leads" element={<LeadsSettingsPage />} />
        <Route path="/settings/service-history" element={<ServiceHistorySettingsPage />} />
        <Route path="/settings/customer-requests" element={<CustomerRequestsSettingsPage />} />
        <Route path="/settings/ai-logs" element={<AiLogsSettingsPage />} />
        <Route path="/settings/team" element={<TeamSettingsPage />} />

        {/* Legacy URLs — redirect to the new single source of truth. */}
        <Route path="/settings/conversations" element={<Navigate to="/conversations" replace />} />
        <Route path="/settings/customers" element={<Navigate to="/clients" replace />} />
        <Route path="/settings/appointments" element={<Navigate to="/appointments" replace />} />
        <Route path="/settings/ai" element={<Navigate to="/ai-admin" replace />} />
        <Route path="/settings/escalations" element={<Navigate to="/escalations" replace />} />
        <Route path="/settings/channels" element={<Navigate to="/channels" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
