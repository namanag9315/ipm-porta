import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { AuthProvider } from './context/AuthContext'
import { useAuth } from './hooks/useAuth'
import LoginPage from './pages/LoginPage'
import IPMOProtectedRoute from './routes/IPMOProtectedRoute'
import ProtectedRoute from './routes/ProtectedRoute'

const DashboardLayout = lazy(() => import('./layouts/DashboardLayout'))
const AttendanceView = lazy(() => import('./pages/AttendanceView'))
const AdminPortal = lazy(() => import('./pages/AdminPortal'))
const AssignmentsView = lazy(() => import('./pages/AssignmentsView'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const GradeSimulator = lazy(() => import('./pages/GradeSimulator'))
const LoanCalculator = lazy(() => import('./pages/LoanCalculator'))
const BusScheduleView = lazy(() => import('./pages/BusScheduleView'))
const CampusSharing = lazy(() => import('./pages/CampusSharing'))
const IPMODashboard = lazy(() => import('./pages/ipmo/IPMODashboard'))
const MessMenuView = lazy(() => import('./pages/MessMenuView'))
const NoticeboardView = lazy(() => import('./pages/NoticeboardView'))
const PollsView = lazy(() => import('./pages/PollsView'))
const ProfileView = lazy(() => import('./pages/ProfileView'))
const ReadingsView = lazy(() => import('./pages/ReadingsView'))
const SplitSettleView = lazy(() => import('./pages/SplitSettleView'))
const TimetableView = lazy(() => import('./pages/TimetableView'))

function RouteLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="rounded-2xl bg-white px-5 py-3 text-sm font-medium text-slate-600 shadow-[0_4px_24px_rgb(0,0,0,0.06)]">
        Loading portal...
      </div>
    </div>
  )
}

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
    <Suspense fallback={<RouteLoadingFallback />}>
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
          <Route path="assignments" element={<AssignmentsView />} />
          <Route path="mess-menu" element={<MessMenuView />} />
          <Route path="noticeboard" element={<NoticeboardView />} />
          <Route path="polls" element={<PollsView />} />
          <Route path="bus-schedule" element={<BusScheduleView />} />
          <Route path="loan-calculator" element={<LoanCalculator />} />
          <Route path="split-settle" element={<SplitSettleView />} />
          <Route path="readings" element={<ReadingsView />} />
          <Route path="profile" element={<ProfileView />} />
        </Route>

        <Route
          path="/calculator"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<GradeSimulator />} />
        </Route>

        <Route
          path="/sharing"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<CampusSharing />} />
        </Route>

        <Route
          path="/ipmo"
          element={
            <IPMOProtectedRoute>
              <IPMODashboard />
            </IPMOProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
