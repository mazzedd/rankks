require('dotenv').config({ path: '../rankks-api/.env' });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

const BASE_URL = 'https://www.thesportsdb.com/api/v1/json/3';
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function slugify(str){return str.toLowerCase().replace(/[àáâãäå]/g,'a').replace(/[èéêë]/g,'e').replace(/[òóôõö]/g,'o').replace(/[ùúûü]/g,'u').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')}
async function fetchJSON(url){const res=await fetch(url);if(!res.ok)throw new Error(`HTTP ${res.status}`);const text=await res.text();if(!text||!text.trim())throw new Error('Empty response');return JSON.parse(text)}

const SEASONS=['2015-2016','2016-2017','2017-2018','2018-2019','2019-2020','2020-2021','2021-2022','2022-2023','2023-2024','2024-2025'];

async function main(){
  console.log('RANKKS — Champions League Ingestion\n');
  await pool.query('SELECT 1');
  console.log('✅ Database connected\n');
  const compRes=await pool.query('SELECT id FROM competitions WHERE slug=$1',['champions-league-uefa']);
  const competition_id=compRes.rows[0]?.id;
  if(!competition_id){console.error('❌ UCL not found');process.exit(1)}

  for(const season of SEASONS){
    const year=parseInt(season.split('-')[1]);
    console.log(`\n📅 Season ${season} (${year})`);
    try{
      const data=await fetchJSON(`${BASE_URL}/eventsseason.php?id=4480&s=${season}`);
      if(!data.events?.length){console.log('  ⚠️  No events');await sleep(600);continue}

      const finalMatch=data.events.find(e=>e.strRound?.toLowerCase().includes('final')||e.strEvent?.toLowerCase().includes('final'))||data.events[data.events.length-1];
      console.log(`  🏆 Final: ${finalMatch?.strEvent}`);

      const sRes=await pool.query(`INSERT INTO seasons(competition_id,year,status)VALUES($1,$2,'past')ON CONFLICT(competition_id,event_id,year,gender)DO UPDATE SET status='past'RETURNING id`,[competition_id,year]);
      const season_id=sRes.rows[0].id;

      const tRes=await pool.query(`INSERT INTO result_tabs(season_id,tab_name,tab_key,typology,display_order,is_default)VALUES($1,'Final Tour','final_tour','game',1,true)ON CONFLICT(season_id,tab_key)DO UPDATE SET tab_name=EXCLUDED.tab_name RETURNING id`,[season_id]);
      const tab_id=tRes.rows[0].id;

      if(finalMatch?.strHomeTeam&&finalMatch?.strAwayTeam){
        const hSlug=slugify(finalMatch.strHomeTeam);
        await pool.query(`INSERT INTO entities(canonical_name,slug,entity_type,is_active)VALUES($1,$2,'club',true)ON CONFLICT(slug)DO NOTHING`,[finalMatch.strHomeTeam,hSlug]);
        const hRes=await pool.query('SELECT id FROM entities WHERE slug=$1',[hSlug]);
        const home_id=hRes.rows[0]?.id;

        const aSlug=slugify(finalMatch.strAwayTeam);
        await pool.query(`INSERT INTO entities(canonical_name,slug,entity_type,is_active)VALUES($1,$2,'club',true)ON CONFLICT(slug)DO NOTHING`,[finalMatch.strAwayTeam,aSlug]);
        const aRes=await pool.query('SELECT id FROM entities WHERE slug=$1',[aSlug]);
        const away_id=aRes.rows[0]?.id;

        if(home_id&&away_id){
          const hs=parseInt(finalMatch.intHomeScore)||0,as2=parseInt(finalMatch.intAwayScore)||0;
          const winner_id=hs>as2?home_id:away_id;
          await pool.query(`INSERT INTO games(result_tab_id,round,match_number,match_date,venue,home_entity_id,away_entity_id,home_entity_type,away_entity_type,score,winner_entity_id,home_won)VALUES($1,'F',1,$2,$3,$4,$5,'club','club',$6,$7,$8)ON CONFLICT DO NOTHING`,[tab_id,finalMatch.dateEvent||null,finalMatch.strVenue||null,home_id,away_id,JSON.stringify({home:hs,away:as2}),winner_id,hs>as2]);
          await pool.query(`INSERT INTO standings(result_tab_id,position,entity_id,entity_type,stats)VALUES($1,1,$2,'club',$3)ON CONFLICT(result_tab_id,position)DO UPDATE SET entity_id=EXCLUDED.entity_id,stats=EXCLUDED.stats`,[tab_id,winner_id,JSON.stringify({titles:1})]);
          console.log(`  ✅ ${finalMatch.strHomeTeam} ${hs}-${as2} ${finalMatch.strAwayTeam}`);
        }
      }
    }catch(err){console.error(`  ❌ ${err.message}`)}
    await sleep(600);
  }
  console.log('\n✅ UCL ingestion complete!');
  await pool.end();
}
main().catch(err=>{console.error('Fatal:',err);process.exit(1)});