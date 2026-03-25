const ACCESS_TOKEN_KEY = 'ipm_access_token'
const REFRESH_TOKEN_KEY = 'ipm_refresh_token'
const USER_KEY = 'ipm_user'
const REMEMBER_ME_KEY = 'ipm_remember_me'
const ADMIN_ACCESS_TOKEN_KEY = 'ipm_admin_access_token'
const ADMIN_USER_KEY = 'ipm_admin_user'

export function getAccessToken() {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY) || localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function getRememberMePreference() {
  const raw = localStorage.getItem(REMEMBER_ME_KEY)
  if (raw === null) {
    return null
  }
  return raw === '1'
}

export function getStoredUser() {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function storeAuth({ accessToken, refreshToken, user, rememberMe = false }) {
  if (accessToken) {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
    if (rememberMe) {
      localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
    } else {
      localStorage.removeItem(ACCESS_TOKEN_KEY)
    }
  }
  if (refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
  }
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  }
  localStorage.setItem(REMEMBER_ME_KEY, rememberMe ? '1' : '0')
}

export function storeUser(user) {
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  }
}

export function clearAuth() {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  localStorage.removeItem(REMEMBER_ME_KEY)
}

export function getAdminAccessToken() {
  return localStorage.getItem(ADMIN_ACCESS_TOKEN_KEY)
}

export function getStoredAdminUser() {
  const raw = localStorage.getItem(ADMIN_USER_KEY)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function storeAdminAuth({ accessToken, user }) {
  if (accessToken) {
    localStorage.setItem(ADMIN_ACCESS_TOKEN_KEY, accessToken)
  }
  if (user) {
    localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(user))
  }
}

export function clearAdminAuth() {
  localStorage.removeItem(ADMIN_ACCESS_TOKEN_KEY)
  localStorage.removeItem(ADMIN_USER_KEY)
}
