// create-motogp-team-entities.js
// Usage: node create-motogp-team-entities.js
//
// MotoGP teams have no entity row at all (unlike F1 teams, entity_type=
// 'f1_team') — motogp_team_standings/motogp_session_results are
// text-only (team_name string, no id), so there's nowhere to attach a
// logo or country in the admin panel. This creates one entity_type=
// 'motogp_team' row per team in the CURRENT season's motogp_team_standings
// (the alias-resolved canonical name, see motogp.js's TEAM_NAME_ALIASES),
// so they show up in the admin Clubs page (grouped under "Moto Racing",
// sports.id=5) the same way F1 teams do, for logo/country entry.
//
// Scope: only the current season's teams for now, not full MotoGP
// history — re-run in future seasons (or extend the year filter below)
// as new teams appear. Idempotent via a slug uniqueness check, safe to
// re-run.
//
// NOTE: this does NOT wire the MotoGP frontend to actually display these
// logos/countries yet — motogp_team_standings.team_name is still a plain
// string, not a foreign key to entities.id. That join is a follow-up once
// logos have actually been entered.

require('dotenv').config();
const { query, queryAll, queryOne, end } = require('./db');

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main() {
  const season = await queryOne(
    `SELECT id, year FROM seasons WHERE competition_id = 4829 AND category = 'motogp' ORDER BY year DESC LIMIT 1`
  );
  if (!season) throw new Error('No MotoGP season found');

  const teams = await queryAll(
    `SELECT DISTINCT team_name FROM motogp_team_standings WHERE season_id = $1 ORDER BY team_name`,
    [season.id]
  );
  console.log(`${teams.length} teams in ${season.year} MotoGP standings (season_id=${season.id})`);

  let created = 0, skipped = 0;
  for (const { team_name } of teams) {
    const existing = await queryOne(
      `SELECT id FROM entities WHERE entity_type = 'motogp_team' AND canonical_name = $1`,
      [team_name]
    );
    if (existing) { skipped++; continue; }

    let slug = slugify(team_name);
    const slugTaken = await queryOne(`SELECT id FROM entities WHERE slug = $1`, [slug]);
    if (slugTaken) slug = `${slug}-motogp`;

    await query(
      `INSERT INTO entities (entity_type, canonical_name, slug, is_active)
       VALUES ('motogp_team', $1, $2, true)`,
      [team_name, slug]
    );
    console.log(`  created: ${team_name} (${slug})`);
    created++;
  }

  console.log(`Done. Created ${created}, already existed ${skipped}.`);
  await end();
}

main().catch(err => { console.error(err); process.exit(1); });
