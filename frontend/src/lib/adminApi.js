import axios from 'axios'

import { getAdminAccessToken } from './storage'

const adminApi = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 60000,
})

adminApi.interceptors.request.use((config) => {
  const token = getAdminAccessToken()
  if (token) {
    config.headers.Authorization = `Token ${token}`
  }
  return config
})

adminApi.interceptors.response.use(
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
    return adminApi(config)
  },
)

export default adminApi
