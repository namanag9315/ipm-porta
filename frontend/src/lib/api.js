import axios from 'axios'

import { getAccessToken, getStoredUser } from './storage'

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
    const shouldRetry =
      config &&
      !config.__retry &&
      (status === 502 || status === 503 || status === 504 || !error.response)
    if (!shouldRetry) {
      return Promise.reject(error)
    }
    config.__retry = true
    return api(config)
  },
)

export default api
