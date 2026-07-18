// tab-titles.js — Admin CRUD for the tab_titles table.
// Mount under the admin router (e.g. router.use('/tab-titles', require('./tab-titles')))
// so these land at /api/admin/tab-titles/*, matching the existing
// /api/admin/media/* convention used by Iconic Moments and Match Videos.
//
// NOTE: adjust the require('../db') path below if this file's actual
// location differs from the other admin route files — I don't have
// visibility into the exact admin routes folder depth, so this mirrors
// the ../db pattern used in the main (non-admin) results.js/seasons.js.
// If admin routes sit one level deeper (e.g. src/routes/admin/), change
// to '../../db'.
const express = require('express');
const router  = express.Router();
const { queryAll, queryOne, query } = require('../db');

// GET /tab-titles?competition_id=X
// All configured title overrides for one competition, newest valid_from
// first within each tab grouping.
router.get('/', async (req, res, next) => {
  try {
    const { competition_id } = req.query;
    if (!competition_id) return res.status(400).json({ error: 'competition_id is required' });

    const rows = await queryAll(`
      SELECT tt.*, c.name AS competition_name
      FROM tab_titles tt
      JOIN competitions c ON c.id = tt.competition_id
      WHERE tt.competition_id = $1
      ORDER BY COALESCE(tt.tab_key, tt.tab_group), tt.section, tt.valid_from DESC
    `, [competition_id]);

    res.json({ data: rows });
  } catch (err) { next(err); }
});

// GET /tab-titles/tab-options?competition_id=X
// Real distinct tab_key and tab_group values actually used across every
// season of this competition — drives the admin form's dropdowns so
// nobody has to free-type (and possibly typo) a tab_key string.
router.get('/tab-options', async (req, res, next) => {
  try {
    const { competition_id } = req.query;
    if (!competition_id) return res.status(400).json({ error: 'competition_id is required' });

    const rows = await queryAll(`
      SELECT DISTINCT rt.tab_key, rt.tab_name, rt.tab_group
      FROM result_tabs rt
      JOIN seasons s ON s.id = rt.season_id
      WHERE s.competition_id = $1
      ORDER BY rt.tab_group NULLS LAST, rt.tab_key
    `, [competition_id]);

    const tabKeys = rows
      .filter(r => r.tab_key)
      .map(r => ({ tab_key: r.tab_key, tab_name: r.tab_name }))
      // De-dupe by tab_key (same tab_key can repeat across many seasons)
      .filter((r, i, arr) => arr.findIndex(x => x.tab_key === r.tab_key) === i);

    const tabGroups = [...new Set(rows.map(r => r.tab_group).filter(Boolean))];

    res.json({ data: { tab_keys: tabKeys, tab_groups: tabGroups } });
  } catch (err) { next(err); }
});

// POST /tab-titles
// Body: { competition_id, tab_key OR tab_group (exactly one), section,
//         title_template, valid_from, valid_to }
router.post('/', async (req, res, next) => {
  try {
    const { competition_id, tab_key, tab_group, section, title_template, valid_from, valid_to } = req.body;

    if (!competition_id || !title_template || !valid_from) {
      return res.status(400).json({ error: 'competition_id, title_template, and valid_from are required' });
    }
    if ((tab_key ? 1 : 0) + (tab_group ? 1 : 0) !== 1) {
      return res.status(400).json({ error: 'Provide exactly one of tab_key or tab_group, not both or neither' });
    }

    const row = await queryOne(`
      INSERT INTO tab_titles (competition_id, tab_key, tab_group, section, title_template, valid_from, valid_to)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [competition_id, tab_key || null, tab_group || null, section || 'default', title_template, valid_from, valid_to || null]);

    res.json({ data: row });
  } catch (err) {
    // Exclusion constraint violation (overlapping valid_from/valid_to
    // range for the same tab_key/tab_group/section) — surface as a
    // friendly 409 rather than a raw Postgres error.
    if (err.code === '23P01') {
      return res.status(409).json({ error: 'This tab/section already has a title configured for an overlapping year range' });
    }
    next(err);
  }
});

// PUT /tab-titles/:id
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tab_key, tab_group, section, title_template, valid_from, valid_to } = req.body;

    if ((tab_key ? 1 : 0) + (tab_group ? 1 : 0) !== 1) {
      return res.status(400).json({ error: 'Provide exactly one of tab_key or tab_group, not both or neither' });
    }

    const row = await queryOne(`
      UPDATE tab_titles
      SET tab_key = $1, tab_group = $2, section = $3,
          title_template = $4, valid_from = $5, valid_to = $6
      WHERE id = $7
      RETURNING *
    `, [tab_key || null, tab_group || null, section || 'default', title_template, valid_from, valid_to || null, id]);

    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  } catch (err) {
    if (err.code === '23P01') {
      return res.status(409).json({ error: 'This tab/section already has a title configured for an overlapping year range' });
    }
    next(err);
  }
});

// DELETE /tab-titles/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await query(`DELETE FROM tab_titles WHERE id = $1`, [req.params.id]);
    res.json({ data: { deleted: true } });
  } catch (err) { next(err); }
});

module.exports = router;
