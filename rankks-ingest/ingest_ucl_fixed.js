require('dotenv').config({ path: '../rankks-api/.env' });
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST||'localhost', port: parseInt(process.env.DB_PORT)||5432,
  database: process.env.DB_NAME||'rankks', user: process.env.DB_USER||'postgres',
  password: process.env.DB_PASSWORD||'rankks123',
});

const UCL_FINALS = [
  { year:2016, home:'Real Madrid',       away:'Atletico Madrid',  home_score:1, away_score:1, penalties:'5-3', winner:'Real Madrid',      venue:'San Siro, Milan',               date:'2016-05-28' },
  { year:2017, home:'Juventus',          away:'Real Madrid',      home_score:1, away_score:4, winner:'Real Madrid',      venue:'Millennium Stadium, Cardiff',    date:'2017-06-03' },
  { year:2018, home:'Real Madrid',       away:'Liverpool',        home_score:3, away_score:1, winner:'Real Madrid',      venue:'NSC Olimpiyskiy, Kyiv',          date:'2018-05-26' },
  { year:2019, home:'Tottenham',         away:'Liverpool',        home_score:0, away_score:2, winner:'Liverpool',        venue:'Wanda Metropolitano, Madrid',    date:'2019-06-01' },
  { year:2020, home:'Paris SG',          away:'Bayern Munich',    home_score:0, away_score:1, winner:'Bayern Munich',    venue:'Estadio Sport Lisboa, Lisbon',   date:'2020-08-23' },
  { year:2021, home:'Manchester City',   away:'Chelsea',          home_score:0, away_score:1, winner:'Chelsea',          venue:'Estadio do Dragao, Porto',       date:'2021-05-29' },
  { year:2022, home:'Liverpool',         away:'Real Madrid',      home_score:0, away_score:1, winner:'Real Madrid',      venue:'Stade de France, Paris',         date:'2022-05-28' },
  { year:2023, home:'Inter Milan',       away:'Manchester City',  home_score:0, away_score:1, winner:'Manchester City',  venue:'Ataturk Olympic Stadium, Istanbul', date:'2023-06-10' },
  { year:2024, home:'Borussia Dortmund', away:'Real Madrid',      home_score:0, away_score:2, winner:'Real Madrid',      venue:'Wembley, London',                date:'2024-06-01' },
  { year:2025, home:'PSG',              away:'Inter Milan',       home_score:1, away_score:0, winner:'PSG',              venue:'Allianz Arena, Munich',          date:'2025-05-31' },
];

const LOGOS = {
  'Real Madrid':'https://r2.thesportsdb.com/images/media/team/badge/vspuw11421679162.png',
  'Atletico Madrid':'https://r2.thesportsdb.com/images/media/team/badge/xctvts1420744407.png',
  'Juventus':'https://r2.thesportsdb.com/images/media/team/badge/5v0cts1704801441.png',
  'Liverpool':'https://r2.thesportsdb.com/images/media/team/badge/uvuuuu1421432737.png',
  'Tottenham':'https://r2.thesportsdb.com/images/media/team/badge/rttqxt1421694785.png',
  'Bayern Munich':'https://r2.thesportsdb.com/images/media/team/badge/tsxwxr1421241008.png',
  'Paris SG':'https://r2.thesportsdb.com/images/media/team/badge/rwqrrq1473504808.png',
  'PSG':'https://r2.thesportsdb.com/images/media/team/badge/rwqrrq1473504808.png',
  'Manchester City':'https://r2.thesportsdb.com/images/media/team/badge/vts2s51615908175.png',
  'Chelsea':'https://r2.thesportsdb.com/images/media/team/badge/wwvsos1508753283.png',
  'Inter Milan':'https://r2.thesportsdb.com/images/media/team/badge/xzqxqx1421244711.png',
  'Borussia Dortmund':'https://r2.thesportsdb.com/images/media/team/badge/xooeqs1467462823.png',
};

function slugify(s){return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')}

async function upsertClub(client, name){
  const slug=slugify(name), logo=LOGOS[name]||null;
  await client.query(`INSERT INTO entities(canonical_name,slug,entity_type,image_url,is_active)VALUES($1,$2,'club',$3,true)ON CONFLICT(slug)DO UPDATE SET image_url=COALESCE(EXCLUDED.image_url,entities.image_url)`,[name,slug,logo]);
  const r=await client.query('SELECT id FROM entities WHERE slug=$1',[slug]);
  return r.rows[0].id;
}

async function main(){
  console.log('RANKKS — UCL Finals Ingestion (corrected)\n');
  await pool.query('SELECT 1');
  console.log('✅ Database connected\n');
  const cr=await pool.query('SELECT id FROM competitions WHERE slug=$1',['champions-league-uefa']);
  const competition_id=cr.rows[0]?.id;
  if(!competition_id){console.error('❌ UCL not found');process.exit(1)}

  for(const f of UCL_FINALS){
    console.log(`\n📅 ${f.year} — ${f.home} vs ${f.away}`);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const sR=await client.query(`INSERT INTO seasons(competition_id,year,status)VALUES($1,$2,'past')ON CONFLICT(competition_id,event_id,year,gender)DO UPDATE SET status='past'RETURNING id`,[competition_id,f.year]);
      const season_id=sR.rows[0].id;
      const tR=await client.query(`INSERT INTO result_tabs(season_id,tab_name,tab_key,typology,display_order,is_default)VALUES($1,'Final Tour','final_tour','game',1,true)ON CONFLICT(season_id,tab_key)DO UPDATE SET is_default=true RETURNING id`,[season_id]);
      const tab_id=tR.rows[0].id;
      await client.query('DELETE FROM games WHERE result_tab_id=$1',[tab_id]);
      await client.query('DELETE FROM standings WHERE result_tab_id=$1',[tab_id]);
      const home_id=await upsertClub(client,f.home);
      const away_id=await upsertClub(client,f.away);
      const winner_id=f.winner===f.home?home_id:away_id;
      const score={home:f.home_score,away:f.away_score,...(f.penalties?{penalties:f.penalties}:{})};
      await client.query(`INSERT INTO games(result_tab_id,round,match_number,match_date,venue,home_entity_id,away_entity_id,home_entity_type,away_entity_type,score,winner_entity_id,home_won)VALUES($1,'F',1,$2,$3,$4,$5,'club','club',$6,$7,$8)`,[tab_id,f.date,f.venue,home_id,away_id,JSON.stringify(score),winner_id,f.winner===f.home]);
      await client.query(`INSERT INTO standings(result_tab_id,position,entity_id,entity_type,stats)VALUES($1,1,$2,'club',$3)ON CONFLICT(result_tab_id,position)DO UPDATE SET entity_id=EXCLUDED.entity_id,stats=EXCLUDED.stats`,[tab_id,winner_id,JSON.stringify({titles:1,winner:true})]);
      await client.query('COMMIT');
      console.log(`  ✅ Winner: ${f.winner} (${f.home_score}-${f.away_score}${f.penalties?' pen '+f.penalties:''})`);
    }catch(err){await client.query('ROLLBACK');console.error(`  ❌ ${err.message}`);}
    finally{client.release();}
  }
  console.log('\n✅ UCL Finals ingestion complete!');
  await pool.end();
}
main().catch(err=>{console.error('Fatal:',err);process.exit(1)});