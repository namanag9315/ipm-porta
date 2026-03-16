import { Navigate } from 'react-router-dom'

import { getAdminAccessToken, getStoredAdminUser } from '../lib/storage'

export default function IPMOProtectedRoute({ children }) {
  const token = getAdminAccessToken()
  const adminUser = getStoredAdminUser()
  const isIPMO = String(adminUser?.role || '').toUpperCase() === 'IPMO'

  if (!token || !isIPMO) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}
