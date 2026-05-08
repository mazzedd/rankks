import { useRef, useEffect } from 'react'
import useAppStore from '../../store/useAppStore'
import styles from './YearSelector.module.css'
const MIN=1968,MAX=new Date().getFullYear()
export default function YearSelector(){
  const{activeYear,changeYear}=useAppStore()
  const years=Array.from({length:MAX-MIN+1},(_,i)=>MIN+i)
  const ref=useRef(null),activeRef=useRef(null)
  useEffect(()=>{activeRef.current?.scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'})},[activeYear])
  return(
    <div className={styles.wrapper}>
      <button className={styles.arrow} onClick={()=>activeYear>MIN&&changeYear(activeYear-1)} disabled={activeYear<=MIN}>‹</button>
      <div className={styles.track} ref={ref}>
        {years.map(y=>(
          <button key={y} ref={y===activeYear?activeRef:null} className={`${styles.year}${y===activeYear?' '+styles.active:''}`} onClick={()=>changeYear(y)}>{y}</button>
        ))}
      </div>
      <button className={styles.arrow} onClick={()=>activeYear<MAX&&changeYear(activeYear+1)} disabled={activeYear>=MAX}>›</button>
    </div>
  )
}