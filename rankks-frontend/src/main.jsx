import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
// BrowserRouter wraps App (not the other way around) so App itself can call
// useUrlSync() — that hook needs useLocation/useNavigate, which only work
// inside a Router's context. See src/routing/useUrlSync.js.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)