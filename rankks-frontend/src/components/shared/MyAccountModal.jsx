import { useState } from 'react'
import useUserStore from '../../store/useUserStore'
import styles from './MyAccountModal.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

const SECTION_ORDER  = ['competition', 'club', 'athlete', 'sport', 'media']
const SECTION_LABELS = {
  competition: 'Competitions',
  club:        'Clubs & Teams',
  athlete:     'Athletes',
  sport:       'Sports',
  media:       'Saved Videos',
}

export default function MyAccountModal() {
  const open              = useUserStore(s => s.accountModalOpen)
  const close             = useUserStore(s => s.closeAccountModal)
  const user               = useUserStore(s => s.user)
  const favourites          = useUserStore(s => s.favourites)
  const toggleFavourite    = useUserStore(s => s.toggleFavourite)
  const updatePreferences  = useUserStore(s => s.updatePreferences)
  const logout             = useUserStore(s => s.logout)

  const [prefPending, setPrefPending] = useState(false)

  if (!open) return null

  const handleOddsToggle = async (e) => {
    const checked = e.target.checked
    setPrefPending(true)
    try {
      await updatePreferences(checked)
    } finally {
      setPrefPending(false)
    }
  }

  const handleLogout = () => {
    logout()
    close()
  }

  const hasAny = SECTION_ORDER.some(t => (favourites[t] || []).length > 0)

  return (
    <div className={styles.backdrop} onMouseDown={close}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.headerRow}>
          <h2 className={styles.title}>My Account</h2>
          <button type="button" className={styles.closeBtn} onClick={close} aria-label="Close">×</button>
        </div>

        <div className={styles.accountInfo}>
          <span className={styles.email}>{user?.email}</span>
          <span className={styles.tier}>{user?.subscription_tier} plan</span>
        </div>

        <label className={styles.prefRow}>
          <span>Show odds data</span>
          <input
            type="checkbox"
            checked={!!user?.show_odds_data}
            onChange={handleOddsToggle}
            disabled={prefPending}
          />
        </label>

        <div className={styles.favouritesList}>
          {!hasAny && (
            <p className={styles.empty}>
              No favourites yet — tap the star on any competition, club, or athlete to follow it.
            </p>
          )}

          {SECTION_ORDER.map(type => {
            const items = favourites[type] || []
            if (!items.length) return null
            return (
              <div key={type} className={styles.section}>
                <div className={styles.sectionLabel}>{SECTION_LABELS[type]}</div>
                {items.map(f => (
                  <div key={f.id} className={styles.row}>
                    {f.image_url && <img src={resolveImg(f.image_url)} alt="" className={styles.rowImg} />}
                    <span className={styles.rowName}>{f.name || `#${f.entity_id}`}</span>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => toggleFavourite(f.entity_type, f.entity_id)}
                      aria-label={`Remove ${f.name || ''}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        <button type="button" className={styles.logoutBtn} onClick={handleLogout}>Log out</button>
      </div>
    </div>
  )
}
