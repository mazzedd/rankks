const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'rankks', user: 'postgres', password: 'rankks123' });
(async () => {
  const r = await pool.query(`
    SELECT st.position, e.canonical_name, st.stats
    FROM standings st
    JOIN entities e ON e.id = st.entity_id
    JOIN result_tabs rt ON rt.id = st.result_tab_id
    WHERE rt.id = 19639
    ORDER BY st.position
    LIMIT 8
  `);
  console.log(JSON.stringify(r.rows, null, 1));
  await pool.end();
})();
