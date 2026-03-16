import axios from 'axios'

import { getAccessToken, getStoredUser } from './storage'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 15000,
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
  return config
})

export default api
