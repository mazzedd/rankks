import { useState, useRef, useEffect } from 'react'
import useUserStore from '../../store/useUserStore'
import styles from './FavouriteStar.module.css'

// Pentagram icon — same construction as the green star on Morocco's flag: a
// pentagon's 5 vertices connected every-other-one in one continuous stroke,
// filled with fill-rule="evenodd" so the crossings leave the small pentagon
// at the centre hollow (Mohamed 2026-08-19: "give a try with the moroccan
// style").
function StarIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <path fillRule="evenodd" d="M12 2 L17.88 20.09 L2.49 8.91 L21.51 8.91 L6.12 20.09 Z" />
    </svg>
  )
}

// Single reusable favourite toggle — entity_type must be one of the coarse
// favourites buckets: sport | competition | club | athlete | media | tour.
// variant="icon" (default) is the plain star, sized via `size`. variant=
// "badge" is the pill/square control used on the ATP/WTA tour banner
// (Mohamed 2026-08-19 sketch: unfollowed = wide "FAVOURITE" + star pill,
// followed = square gold-star-only badge — collapsing rather than just
// recoloring, so the state change reads at a glance without having to
// notice a color swap).
export default function FavouriteStar({ entityType, entityId, label, size = 'md', variant = 'icon', className = '', onToggled }) {
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
      } else {
        // added/removed — let callers with a derived count (e.g. a public
        // follower total) refetch it rather than try to keep it in sync themselves.
        onToggled?.(result)
      }
    } catch {
      // Network/server failure — no optimistic state left to reconcile
      // beyond what the store already rolled back; fail silently on the UI.
    } finally {
      setPending(false)
    }
  }

  const ariaLabel = isFavourited ? `Unfollow ${label || ''}` : `Follow ${label || ''}`

  return (
    <div className={styles.wrap} ref={wrapRef}>
      {variant === 'badge' ? (
        <button
          type="button"
          className={`${styles.badge}${isFavourited ? ' ' + styles.badgeActive : ''} ${className}`}
          onClick={handleClick}
          disabled={pending}
          aria-pressed={isFavourited}
          aria-label={ariaLabel}
          title={isFavourited ? 'Unfollow' : 'Follow'}
        >
          {!isFavourited && <span className={styles.badgeLabel}>FAVOURITE</span>}
          <StarIcon className={styles.badgeIcon} />
        </button>
      ) : (
        <button
          type="button"
          className={`${styles.star} ${styles[size]}${isFavourited ? ' ' + styles.active : ''} ${className}`}
          onClick={handleClick}
          disabled={pending}
          aria-pressed={isFavourited}
          aria-label={ariaLabel}
          title={isFavourited ? 'Unfollow' : 'Follow'}
        >
          <StarIcon className={styles.icon} />
        </button>
      )}

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
