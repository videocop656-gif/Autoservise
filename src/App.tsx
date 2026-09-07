import { Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import BusinessSettingsPage from './pages/settings/BusinessSettingsPage'
import HoursSettingsPage from './pages/settings/HoursSettingsPage'
import ServicesSettingsPage from './pages/settings/ServicesSettingsPage'
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
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
