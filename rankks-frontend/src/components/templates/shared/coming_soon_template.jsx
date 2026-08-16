// templates/shared/coming_soon_template.jsx
// Generic placeholder for any result_tab whose real content/columns
// haven't been designed yet (e.g. football's All-Time group: Player
// Stats/Team Stats/Champion History — tabs exist and navigate correctly,
// data shape is still being spec'd). Not sport- or tab-specific: title
// comes from tabName (only populated for tab_group children, see
// ContentArea.jsx's renderContent), so one component covers every
// "coming soon" tab regardless of which sport/tab_group added it.
export default function ComingSoonTemplate() {
  return (
    <div style={{ padding: '40px 16px' }}>
      <div style={{ marginTop: 8, color: 'var(--text3)' }}>
        This page is coming soon.
      </div>
    </div>
  )
}
