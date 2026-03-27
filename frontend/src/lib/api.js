import axios from 'axios'

import { getAccessToken, getStoredUser } from './storage'

const SAFE_RETRY_METHODS = new Set(['get', 'head', 'options'])
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524])

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
})

api.interceptors.request.use((config) => {
  const token = getAccessToken()
  const user = getStoredUser()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  if (user?.batchCode && !config.headers['X-Batch-Code']) {
    config.headers['X-Batch-Code'] = user.batchCode
  }
  if (user?.rollNumber && !config.headers['X-Student-Roll-Number']) {
    config.headers['X-Student-Roll-Number'] = user.rollNumber
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error?.config
    const status = error?.response?.status
    const method = String(config?.method || 'get').toLowerCase()
    const retryCount = Number(config?.__retryCount || 0)
    const shouldRetry =
      config &&
      SAFE_RETRY_METHODS.has(method) &&
      retryCount < 1 &&
      (!error.response || RETRYABLE_STATUSES.has(status))
    if (!shouldRetry) {
      return Promise.reject(error)
    }

    config.__retryCount = retryCount + 1
    await new Promise((resolve) => setTimeout(resolve, 350))
    return api(config)
  },
)

export default api
