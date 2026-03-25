import { useEffect, useMemo, useState } from 'react'

import { AuthContext } from './auth-context'
import api from '../lib/api'
import { clearAuth, getAccessToken, getStoredUser, storeAuth, storeUser } from '../lib/storage'

const RETRYABLE_LOGIN_STATUSES = new Set([408, 502, 503, 504, 520, 521, 522, 523, 524])

const sleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs))

function normalizeLoginPayload(payload, rollNumber) {
  const accessToken =
    payload?.access || payload?.token || payload?.access_token || payload?.tokens?.access
  const refreshToken =
    payload?.refresh || payload?.refresh_token || payload?.tokens?.refresh || null

  const responseUser = payload?.user || {}
  const user = {
    rollNumber:
      responseUser?.roll_number ||
      responseUser?.rollNumber ||
      payload?.roll_number ||
      rollNumber,
    batchCode:
      responseUser?.batch_code ||
      responseUser?.batchCode ||
      payload?.batch_code ||
      payload?.batchCode ||
      '',
    name: responseUser?.name || payload?.name || rollNumber,
    section: responseUser?.section || payload?.section || '',
    email: responseUser?.email || payload?.email || '',
    dateOfBirth: responseUser?.date_of_birth || payload?.date_of_birth || null,
  }

  return { accessToken, refreshToken, user }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const token = getAccessToken()
    if (!token) {
      setUser(null)
    }
  }, [])

  const login = async ({ rollNumber, password, captchaToken = '', rememberMe = false }) => {
    setLoading(true)
    try {
      const response = await loginWithRetry({ rollNumber, password, captchaToken })

      const { accessToken, refreshToken, user: parsedUser } = normalizeLoginPayload(
        response.data,
        rollNumber,
      )

      if (!accessToken) {
        throw new Error('Login response did not include an access token.')
      }

      storeAuth({ accessToken, refreshToken, user: parsedUser, rememberMe })
      setUser(parsedUser)
      return parsedUser
    } finally {
      setLoading(false)
    }
  }

  const logout = () => {
    clearAuth()
    setUser(null)
  }

  async function loginWithRetry({ rollNumber, password, captchaToken = '' }) {
    const payload = { roll_number: rollNumber, password }
    if (captchaToken) {
      payload.captcha_token = captchaToken
    }
    const maxAttempts = 3
    let attempt = 0

    while (attempt < maxAttempts) {
      try {
        return await api.post('/api/auth/login/', payload)
      } catch (error) {
        attempt += 1
        const status = error?.response?.status
        const isRetryable =
          !error?.response ||
          error?.code === 'ECONNABORTED' ||
          RETRYABLE_LOGIN_STATUSES.has(status)

        if (!isRetryable || attempt >= maxAttempts) {
          throw error
        }

        await sleep(800 * attempt)
      }
    }

    throw new Error('Login retries exhausted.')
  }

  const updateUserProfile = (partialUser) => {
    setUser((current) => {
      const merged = { ...(current || {}), ...(partialUser || {}) }
      storeUser(merged)
      return merged
    })
  }

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user && getAccessToken()),
      loading,
      login,
      logout,
      updateUserProfile,
    }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
