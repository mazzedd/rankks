import { createContext, useContext, useState } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('rankks_admin_token'))
  const [username, setUsername] = useState(() => localStorage.getItem('rankks_admin_user'))

  const login = (token, username) => {
    localStorage.setItem('rankks_admin_token', token)
    localStorage.setItem('rankks_admin_user', username)
    setToken(token)
    setUsername(username)
  }

  const logout = () => {
    localStorage.removeItem('rankks_admin_token')
    localStorage.removeItem('rankks_admin_user')
    setToken(null)
    setUsername(null)
  }

  return (
    <AuthContext.Provider value={{ token, username, login, logout, isAuth: !!token }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
