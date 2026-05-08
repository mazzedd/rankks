import { useEffect, useState } from 'react'
import { api } from '../../services/api'
import styles from './VideoStrip.module.css'
export default function VideoStrip({seasonId}){
  const[videos,setVideos]=useState([])
  useEffect(()=>{
    if(!seasonId)return
    api.getMedia(seasonId).then(d=>setVideos((d||[]).filter(m=>m.media_type==='video'))).catch(()=>setVideos([]))
  },[seasonId])
  if(!videos.length)return null
  return(
    <div className={styles.strip}>
      <div className={styles.title}>▶ Browse favourite moments</div>
      <div className={styles.track}>
        {videos.map(v=>(
          <a key={v.id} href={v.url} target="_blank" rel="noopener noreferrer" className={styles.card}>
            {v.thumbnail_url?<img src={v.thumbnail_url} alt={v.title} className={styles.thumb}/>:<div className={styles.ph}><span>▶</span></div>}
            <div className={styles.label}>{v.title}</div>
          </a>
        ))}
      </div>
    </div>
  )
}