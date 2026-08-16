import axios from 'axios'

// Admin is served from its own origin (e.g. admin.rankks.com), separate
// from the API's origin — so unlike the public frontend it can't rely on
// relative paths and needs an absolute base URL, set per environment via
// VITE_API_ORIGIN (see .env.production).
export const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || 'http://localhost:3000'

// Admin-specific routes (/api/admin/athletes, /api/admin/clubs, etc.)
const api = axios.create({
  baseURL: `${API_ORIGIN}/api/admin`,
  headers: { 'Content-Type': 'application/json' },
})

// Public API routes (/api/competitions, /api/seasons, etc.)
export const publicApi = axios.create({
  baseURL: `${API_ORIGIN}/api`,
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
