import { useEffect, useState } from 'react'
import useUserStore from '../../store/useUserStore'
import styles from './AuthModal.module.css'

export default function AuthModal() {
  const open       = useUserStore(s => s.authModalOpen)
  const initialMode = useUserStore(s => s.authModalMode)
  const close  = useUserStore(s => s.closeAuthModal)
  const signup = useUserStore(s => s.signup)
  const login  = useUserStore(s => s.login)

  const [mode, setMode]   = useState(initialMode) // 'signup' | 'login'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (open) setMode(initialMode)
  }, [open, initialMode])

  if (!open) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      if (mode === 'signup') await signup(email, password, displayName)
      else await login(email, password)
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={styles.backdrop} onMouseDown={close}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className={styles.closeBtn} onClick={close} aria-label="Close">×</button>

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab}${mode === 'signup' ? ' ' + styles.tabActive : ''}`}
            onClick={() => { setMode('signup'); setError(null) }}
          >
            Sign up
          </button>
          <button
            type="button"
            className={`${styles.tab}${mode === 'login' ? ' ' + styles.tabActive : ''}`}
            onClick={() => { setMode('login'); setError(null) }}
          >
            Log in
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          {mode === 'signup' && (
            <input
              type="text"
              placeholder="Display name (optional)"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={styles.input}
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={styles.input}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={styles.input}
            required
            minLength={mode === 'signup' ? 8 : undefined}
          />

          {error && <div className={styles.error}>{error}</div>}

          <button type="submit" className={styles.submit} disabled={pending}>
            {pending ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Log in'}
          </button>
        </form>
      </div>
    </div>
  )
}
