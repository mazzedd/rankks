// templates/home/home_template.jsx
// Home tab (Line A, first entry) — shared across football/basketball
// (ContentArea.jsx renders this directly for activeTab === 'home',
// bypassing the typology/registry lookup since there's no real
// result_tabs row backing it).
//
// Quadrennial/biennial football competitions (World Cup today, any future
// one with the same Final Tour shape — same isQuadOrBiennial check as
// EventBlock.jsx, not a World-Cup-specific flag) get the real banner
// (pink pill + "Home of X") plus the full match schedule for this ONE
// browsed edition (2026-08-13 spec) — distinct from All-Time > Champion
// History, which is the cross-edition winners table (2026-08-12, Mohamed:
// "Home of World Cup is something tot diff") — see
// templates/teams/football_champion_history_knockout_template.jsx for that
// one, and football_home_knockout_template.jsx for this tab's own content.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import { FootballHomeBlock } from '../../EventBlock/EventBlock'
import FootballHomeKnockoutTemplate from './football_home_knockout_template'

export default function HomeTemplate({ pageTitle, competition, seasonId, year, competitionSlug }) {
  const isQuadOrBiennial = competition?.competition_type === 'quadrennial' || competition?.competition_type === 'biennial'

  // Admin-configured subtitle line (rankks-admin's Subtitles page) — Home
  // is shared across every sport (Mohamed: "same for every single sport
  // -> all sports/shared"), so it resolves at the pure global tier, no
  // sportSlug/competitionSlug needed.
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!year) return
    api.getSubtitle(null, null, 'Home', null, year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [year])

  return (
    <>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}
      {isQuadOrBiennial && <FootballHomeBlock competition={competition} pageTitle={pageTitle} />}
      {isQuadOrBiennial ? (
        <FootballHomeKnockoutTemplate seasonId={seasonId} competitionName={competition?.name} competitionSlug={competitionSlug} year={year} />
      ) : (
        <div style={{ padding: '40px 16px' }}>
          <div style={{ marginTop: 8, color: 'var(--text3)' }}>
            This page is coming soon.
          </div>
        </div>
      )}
    </>
  )
}
