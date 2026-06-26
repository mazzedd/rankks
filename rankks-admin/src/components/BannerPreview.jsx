import styles from './BannerPreview.module.css'

export default function BannerPreview({ name, category, primary, secondary, third }) {
  const bg1 = primary   || '#1a1a2e'
  const bg2 = secondary || '#2a2a4e'
  const bg3 = third     || bg1

  const bannerStyle = {
    background: `linear-gradient(135deg, ${bg1} 0%, ${bg2} 60%, ${bg3} 100%)`,
  }

  const bottomStyle = {
    background: primary || '#1a1a2e',
    borderTop: `2px solid ${secondary || '#2a2a4e'}`,
  }

  const topLineStyle = {
    background: secondary || '#2a2a4e',
  }

  return (
    <div className={styles.banner} style={bannerStyle}>
      {/* Top accent line */}
      <div className={styles.topLine} style={topLineStyle} />

      {/* Diagonal streaks */}
      <svg className={styles.streaks} viewBox="0 0 800 220" preserveAspectRatio="xMidYMid slice">
        <defs><clipPath id="pc"><rect width="800" height="220"/></clipPath></defs>
        <g clipPath="url(#pc)">
          <polygon points="420,-20 380,-20 250,240 290,240" fill="rgba(255,255,255,0.04)"/>
          <polygon points="520,-20 490,-20 360,240 390,240" fill="rgba(255,255,255,0.03)"/>
          <polygon points="600,-20 580,-20 450,240 470,240" fill="rgba(255,255,255,0.025)"/>
        </g>
      </svg>

      <div className={styles.overlay} />

      {/* Content */}
      <div className={styles.inner}>
        <div className={styles.left}>
          <div className={styles.logoCircle}>
            {(name || 'X').slice(0, 2).toUpperCase()}
          </div>
          <div className={styles.info}>
            <div className={styles.category}>{category || 'Category'}</div>
            <div className={styles.name}>{name || 'Event Name'}</div>
            <div className={styles.subline}>Men's single champion</div>
          </div>
        </div>
        <div className={styles.right}>
          <div className={styles.avatar}>?</div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className={styles.bottom} style={bottomStyle}>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Schedule</div>
          <div className={styles.statVal}>2024</div>
        </div>
        <div className={styles.statSep} />
        <div className={styles.stat}>
          <div className={styles.statLabel}>Edition</div>
          <div className={styles.statVal}>68</div>
        </div>
        <div className={styles.statSep} />
        <div className={styles.stat}>
          <div className={styles.statLabel}>Participations / Titles</div>
          <div className={styles.statVal}>36 / 24</div>
        </div>
        <div className={styles.rankks}>RANKKS</div>
      </div>
    </div>
  )
}
