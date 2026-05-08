import styles from './EmptyState.module.css'
const IC={no_data:'📊',not_founded:'🏗️',dissolved:'📜',no_edition:'📅',cancelled:'❌',default:'🔍'}
export default function EmptyState({type='default',message,previousEdition,nextEdition,onNavigate}){
  return(
    <div className={styles.w}>
      <div className={styles.icon}>{IC[type]||IC.default}</div>
      <p className={styles.msg}>{message||'No data available for this selection.'}</p>
      {(previousEdition||nextEdition)&&(
        <div className={styles.nav}>
          {previousEdition&&<button className={styles.btn} onClick={()=>onNavigate?.(previousEdition)}>← {previousEdition}</button>}
          {nextEdition&&<button className={styles.btn} onClick={()=>onNavigate?.(nextEdition)}>{nextEdition} →</button>}
        </div>
      )}
    </div>
  )
}