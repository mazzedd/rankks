import styles from './FavouriteView.module.css'

// Placeholder for the "favourite page" — a simplified competition view that
// hides Line A/B entirely, reached only via a favourited-competition click
// in ShortcutBar (see useAppStore's openFavouriteView). Test scaffold only:
// proves the hide-LineA/B + close-via-X mechanism before the real page
// design (Build Log — Favourites + Subscription scaffolding, follow-up).
export default function FavouriteView({ onClose }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.label}>FAVOURITE TEMPLATE</span>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
      </div>
    </div>
  )
}
