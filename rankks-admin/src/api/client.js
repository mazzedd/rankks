import axios from 'axios'

// Admin-specific routes (/api/admin/athletes, /api/admin/clubs, etc.)
const api = axios.create({
  baseURL: 'http://localhost:3000/api/admin',
  headers: { 'Content-Type': 'application/json' },
})

// Public API routes (/api/competitions, /api/seasons, etc.)
export const publicApi = axios.create({
  baseURL: 'http://localhost:3000/api',
  headers: { 'Content-Type': 'application/json' },
})

const authInterceptor = config => {
  const token = localStorage.getItem('rankks_admin_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
}

const errorInterceptor = err => {
  if (err.response?.status === 401 || err.response?.status === 403) {
    localStorage.removeItem('rankks_admin_token')
    localStorage.removeItem('rankks_admin_user')
    window.location.href = '/login'
  }
  return Promise.reject(err)
}

api.interceptors.request.use(authInterceptor)
api.interceptors.response.use(res => res, errorInterceptor)

publicApi.interceptors.request.use(authInterceptor)
publicApi.interceptors.response.use(res => res, errorInterceptor)

export default api
