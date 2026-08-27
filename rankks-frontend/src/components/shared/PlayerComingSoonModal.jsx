// components/shared/PlayerComingSoonModal.jsx
// "Player page coming soon" overlay (Mohamed 2026-08-25: "Player name is
// clickable: opens the coming soon player page") — mounted once in App.jsx,
// same independent-of-navigation shape as AuthModal (backdrop + centered
// card, closes on backdrop click/X/Escape). Not a real routed page yet —
// there's no per-player profile built, so clicking a name across any
// All-Time/Scorers/Passers/Players table just surfaces this placeholder
// instead of a 404 or a dead link.
import { useEffect } from 'react'
import useAppStore from '../../store/useAppStore'
import styles from './PlayerComingSoonModal.module.css'

export default function PlayerComingSoonModal() {
  const player = useAppStore(s => s.playerModal)
  const close  = useAppStore(s => s.closePlayerModal)

  useEffect(() => {
    if (!player) return
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [player, close])

  if (!player) return null

  return (
    <div className={styles.backdrop} onMouseDown={close}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className={styles.closeBtn} onClick={close} aria-label="Close">×</button>
        <div className={styles.title}>{player.name}</div>
        <div className={styles.body}>Player page coming soon.</div>
      </div>
    </div>
  )
}
