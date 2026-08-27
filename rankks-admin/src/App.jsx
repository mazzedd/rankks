import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Competitions from './pages/Competitions'
import Entities from './pages/Entities'
import Athletes from './pages/Athletes'
import Clubs from './pages/Clubs'
import Partners from './pages/Partners'
import Providers from './pages/Providers'
import MatchVideos from './pages/MatchVideos'
import IconicMoments from './pages/IconicMoments'
import Subtitles from './pages/Subtitles'
import CompetitionLogos from './pages/CompetitionLogos'
import EntityLogos from './pages/EntityLogos'
import CompetitionNaming from './pages/CompetitionNaming'
import RaceNaming from './pages/RaceNaming'
import DefaultPage from './pages/DefaultPage'
import FollowersLeagues from './pages/FollowersLeagues'
import MyReports from './pages/MyReports'

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
        <Route path="brands" element={<Partners />} />
        <Route path="providers" element={<Providers />} />
        <Route path="match-videos" element={<MatchVideos />} />
        <Route path="iconic-moments" element={<IconicMoments />} />
        <Route path="subtitles" element={<Subtitles />} />
        <Route path="competition-logos" element={<CompetitionLogos />} />
        <Route path="entity-logos" element={<EntityLogos />} />
        <Route path="competition-naming" element={<CompetitionNaming />} />
        <Route path="race-naming" element={<RaceNaming />} />
        <Route path="default-page" element={<DefaultPage />} />
        <Route path="followers/leagues" element={<FollowersLeagues />} />
        <Route path="reports" element={<MyReports />} />
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
