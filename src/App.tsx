import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
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
import ProtectedRoute from './components/ProtectedRoute'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/business"
        element={
          <ProtectedRoute>
            <BusinessSettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/hours"
        element={
          <ProtectedRoute>
            <HoursSettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/services"
        element={
          <ProtectedRoute>
            <ServicesSettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/knowledge"
        element={
          <ProtectedRoute>
            <KnowledgeSettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/rules"
        element={
          <ProtectedRoute>
            <RulesSettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/customers"
        element={
          <ProtectedRoute>
            <CustomersSettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/vehicles"
        element={
          <ProtectedRoute>
            <VehiclesSettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/leads"
        element={
          <ProtectedRoute>
            <LeadsSettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/appointments"
        element={
          <ProtectedRoute>
            <AppointmentsSettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/service-history"
        element={
          <ProtectedRoute>
            <ServiceHistorySettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/customer-requests"
        element={
          <ProtectedRoute>
            <CustomerRequestsSettingsPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
