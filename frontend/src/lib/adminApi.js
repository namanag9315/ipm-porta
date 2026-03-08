import axios from 'axios'

import { getAdminAccessToken } from './storage'

const adminApi = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 20000,
})

adminApi.interceptors.request.use((config) => {
  const token = getAdminAccessToken()
  if (token) {
    config.headers.Authorization = `Token ${token}`
  }
  return config
})

export default adminApi
