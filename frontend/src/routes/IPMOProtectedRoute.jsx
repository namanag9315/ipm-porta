import { Navigate } from 'react-router-dom'

import { getAdminAccessToken, getStoredAdminUser } from '../lib/storage'

export default function IPMOProtectedRoute({ children }) {
  const token = getAdminAccessToken()
  const adminUser = getStoredAdminUser()
  const isIPMO = String(adminUser?.role || '').toUpperCase() === 'IPMO'

  if (!token) {
    return (
      <Navigate
        to="/admin-portal"
        replace
        state={{ authError: 'Admin login required for IPMO portal.' }}
      />
    )
  }

  if (!isIPMO) {
    return (
      <Navigate
        to="/admin-portal"
        replace
        state={{ authError: 'IPMO account required. Sign in with superuser credentials.' }}
      />
    )
  }

  return children
}
