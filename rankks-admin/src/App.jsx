import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Competitions from './pages/Competitions'
import Entities from './pages/Entities'
import Athletes from './pages/Athletes'
import Clubs from './pages/Clubs'
import MatchVideos from './pages/MatchVideos'
import IconicMoments from './pages/IconicMoments'

function ProtectedRoute({ children }) {
  const { isAuth } = useAuth()
  return isAuth ? children : <Navigate to="/login" replace />
}

function AppRoutes() {
  const { isAuth } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={isAuth ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="competitions" element={<Competitions />} />
        <Route path="entities" element={<Entities />} />
        <Route path="athletes" element={<Athletes />} />
        <Route path="clubs" element={<Clubs />} />
        <Route path="match-videos" element={<MatchVideos />} />
        <Route path="iconic-moments" element={<IconicMoments />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
