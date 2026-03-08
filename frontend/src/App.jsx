import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { AuthProvider } from './context/AuthContext'
import { useAuth } from './hooks/useAuth'
import DashboardLayout from './layouts/DashboardLayout'
import AttendanceView from './pages/AttendanceView'
import AdminPortal from './pages/AdminPortal'
import Dashboard from './pages/Dashboard'
import LoanCalculator from './pages/LoanCalculator'
import LoginPage from './pages/LoginPage'
import MessMenuView from './pages/MessMenuView'
import ProfileView from './pages/ProfileView'
import ReadingsView from './pages/ReadingsView'
import TimetableView from './pages/TimetableView'
import ProtectedRoute from './routes/ProtectedRoute'

function LoginRoute() {
  const { isAuthenticated } = useAuth()
  const location = useLocation()

  if (isAuthenticated) {
    const to = location.state?.from?.pathname || '/dashboard'
    return <Navigate to={to} replace />
  }

  return <LoginPage />
}

function RootRedirect() {
  const { isAuthenticated } = useAuth()
  return <Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/admin-portal" element={<AdminPortal />} />

      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="attendance" element={<AttendanceView />} />
        <Route path="timetable" element={<TimetableView />} />
        <Route path="mess-menu" element={<MessMenuView />} />
        <Route path="loan-calculator" element={<LoanCalculator />} />
        <Route path="readings" element={<ReadingsView />} />
        <Route path="profile" element={<ProfileView />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
