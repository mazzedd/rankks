import { useState, useRef, useEffect } from 'react'
import useUserStore from '../../store/useUserStore'
import styles from './FavouriteStar.module.css'

// Single reusable favourite toggle — used identically on league shortcuts,
// athlete/club rows, and video cards (see Build Log — Favourites +
// Subscription scaffolding). entity_type must be one of the coarse
// favourites buckets: sport | competition | club | athlete | media.
export default function FavouriteStar({ entityType, entityId, label, size = 'md', className = '' }) {
  const isFavourited   = useUserStore(s => s.isFavourited(entityType, entityId))
  const toggleFavourite = useUserStore(s => s.toggleFavourite)
  const openAuthModal  = useUserStore(s => s.openAuthModal)
  const [pending, setPending] = useState(false)
  const [notice, setNotice]   = useState(null) // { kind: 'signedOut' | 'cap', message }
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!notice) return
    const onOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setNotice(null)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [notice])

  const handleClick = async (e) => {
    e.stopPropagation()
    if (pending) return
    setPending(true)
    try {
      const result = await toggleFavourite(entityType, entityId)
      if (result.signedOut) {
        setNotice({ kind: 'signedOut', message: `Sign up to follow ${label || 'this'}` })
      } else if (result.capReached) {
        setNotice({ kind: 'cap', message: result.message })
      }
    } catch {
      // Network/server failure — no optimistic state left to reconcile
      // beyond what the store already rolled back; fail silently on the UI.
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={`${styles.star} ${styles[size]}${isFavourited ? ' ' + styles.active : ''} ${className}`}
        onClick={handleClick}
        disabled={pending}
        aria-pressed={isFavourited}
        aria-label={isFavourited ? `Unfollow ${label || ''}` : `Follow ${label || ''}`}
        title={isFavourited ? 'Unfollow' : 'Follow'}
      >
        <svg viewBox="0 0 24 24" className={styles.icon}>
          <path d="M12 2.5l3.09 6.26 6.91 1-5 4.87 1.18 6.87L12 18.27l-6.18 3.23L7 14.63l-5-4.87 6.91-1z" />
        </svg>
      </button>

      {notice && (
        <div className={`${styles.notice}${notice.kind === 'cap' ? ' ' + styles.noticeCap : ''}`}>
          {notice.kind === 'signedOut' ? (
            <>
              {notice.message}{' '}
              <button
                type="button"
                className={styles.noticeAction}
                onClick={() => { setNotice(null); openAuthModal() }}
              >
                Sign up
              </button>
            </>
          ) : (
            notice.message
          )}
        </div>
      )}
    </div>
  )
}
