import { useEffect, useState } from 'react'
import useAppStore from '../../store/useAppStore'
import { api } from '../../services/api'
import styles from './Sidebar.module.css'

const ATP_SLUGS = ['atp-masters-1000', 'atp-masters-500', 'atp-masters-250']
const WTA_SLUGS = ['wta-1000', 'wta-500', 'wta-250']

export default function Sidebar() {
  const { activeSport, activeCompetition, activeCategory, changeCompetition, setCategory } = useAppStore()
  const [sportData, setSportData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!activeSport) return
    setLoading(true)
    api.getSport(activeSport)
      .then(setSportData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [activeSport])

  if (!activeSport) return (
    <aside className={styles.sidebar}>
      <div className={styles.empty}><p>Select a sport</p></div>
    </aside>
  )

  if (loading) return (
    <aside className={styles.sidebar}>
      <div className={styles.loading}>
        {[...Array(5)].map((_, i) => (
          <div key={i} className={`${styles.sk} skeleton`} />
        ))}
      </div>
    </aside>
  )

  const cats = sportData?.categories || []
  const isTennis   = activeSport === 'tennis'
  const isCarRacing = activeSport === 'car-racing'

  // ── CAR RACING sidebar — only show championship entries, not individual GPs ─
  if (isCarRacing) {
    return (
      <aside className={styles.sidebar}>
        <div className={styles.header}>
          <span className={styles.sportName}>{sportData?.name}</span>
        </div>
        <nav className={styles.nav}>
          {cats.map(cat => {
            // Only show the championship competition (slug contains no year suffix)
            const comps = (cat.competitions || []).filter(c =>
              !/-\d{4}$/.test(c.slug)
            )
            if (!comps.length) return null
            return (
              <div key={cat.id} className={styles.group}>
                <div className={styles.groupLabel}>{cat.short_name}</div>
                {comps.map(c => (
                  <CompBtn
                    key={c.id}
                    name={c.name}
                    slug={c.slug}
                    active={activeCompetition === c.slug}
                    onSelect={changeCompetition}
                    indent
                  />
                ))}
              </div>
            )
          })}
        </nav>
      </aside>
    )
  }

  // ── FOOTBALL sidebar (unchanged) ─────────────────────────────
  if (!isTennis) {
    return (
      <aside className={styles.sidebar}>
        <div className={styles.header}>
          <span className={styles.sportName}>{sportData?.name}</span>
        </div>
        <nav className={styles.nav}>
          {cats.map(cat => {
            const comps = cat.competitions || []
            if (comps.length <= 1) {
              const c = comps[0]
              if (!c) return null
              return (
                <CompBtn
                  key={c.id}
                  name={c.name}
                  slug={c.slug}
                  active={activeCompetition === c.slug}
                  onSelect={changeCompetition}
                />
              )
            }
            return (
              <div key={cat.id} className={styles.group}>
                <div className={styles.groupLabel}>{cat.short_name}</div>
                {comps.map(c => (
                  <CompBtn
                    key={c.id}
                    name={c.name}
                    slug={c.slug}
                    active={activeCompetition === c.slug}
                    onSelect={changeCompetition}
                    indent
                  />
                ))}
              </div>
            )
          })}
        </nav>
      </aside>
    )
  }

  // ── TENNIS sidebar ────────────────────────────────────────────
  const grandSlam = cats.find(c => c.slug === 'grand-slam')
  const atpCats   = cats.filter(c => ATP_SLUGS.includes(c.slug))
  const wtaCats   = cats.filter(c => WTA_SLUGS.includes(c.slug))

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.sportName}>{sportData?.name}</span>
      </div>
      <nav className={styles.nav}>

        {/* Grand Slam */}
        {grandSlam && (
          <CatBtn
            cat={grandSlam}
            activeCategory={activeCategory}
            onSelect={setCategory}
          />
        )}

        {/* ATP section */}
        {atpCats.length > 0 && (
          <>
            <div className={styles.sectionLabel}>ATP</div>
            {atpCats.map(cat => (
              <CatBtn
                key={cat.id}
                cat={cat}
                activeCategory={activeCategory}
                onSelect={setCategory}
                indent
              />
            ))}
          </>
        )}

        {/* WTA section */}
        {wtaCats.length > 0 && (
          <>
            <div className={styles.sectionLabel}>WTA</div>
            {wtaCats.map(cat => (
              <CatBtn
                key={cat.id}
                cat={cat}
                activeCategory={activeCategory}
                onSelect={setCategory}
                indent
              />
            ))}
          </>
        )}

      </nav>
    </aside>
  )
}

function CatBtn({ cat, activeCategory, onSelect, indent }) {
  const isActive = activeCategory === cat.slug
  return (
    <button
      className={`${styles.comp}${isActive ? ' ' + styles.active : ''}${indent ? ' ' + styles.indent : ''}`}
      onClick={() => onSelect(cat.slug)}
    >
      {isActive && <span className={styles.indicator} />}
      <span>{cat.short_name}</span>
    </button>
  )
}

function CompBtn({ name, slug, active, onSelect, indent }) {
  return (
    <button
      className={`${styles.comp}${active ? ' ' + styles.active : ''}${indent ? ' ' + styles.indent : ''}`}
      onClick={() => onSelect(slug)}
    >
      {active && <span className={styles.indicator} />}
      <span>{name}</span>
    </button>
  )
}
