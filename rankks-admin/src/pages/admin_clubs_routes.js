// ── Admin Clubs routes ─────────────────────────────────────────────────────
// Add these to admin.js alongside the existing competitions routes

// GET /admin/clubs
// Returns all entities of type 'club' grouped with sport/country info
router.get('/clubs', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        e.id,
        e.canonical_name,
        e.slug,
        e.country_id,
        e.primary_color,
        e.secondary_color,
        e.third_color,
        e.founded_year,
        e.is_active,
        c.name        AS country_name,
        s.name        AS sport_name,
        s.id          AS sport_id,
        el.logo_url
      FROM entities e
      LEFT JOIN countries c        ON c.id = e.country_id
      LEFT JOIN club_competitions cc ON cc.club_id = e.id
      LEFT JOIN competitions comp  ON comp.id = cc.competition_id
      LEFT JOIN sports s           ON s.id = comp.sport_id
      LEFT JOIN entity_logos el    ON el.entity_id = e.id AND el.is_current = true
      WHERE e.entity_type = 'club'
      GROUP BY e.id, c.name, s.name, s.id, el.logo_url
      ORDER BY c.name, e.canonical_name
    `)
    res.json(rows)
  } catch (err) {
    console.error('GET /admin/clubs error:', err)
    res.status(500).json({ error: err.message })
  }
})

// PUT /admin/clubs/:id
// Updates colors, founded_year, and logo_url (via entity_logos) for a club
router.put('/clubs/:id', async (req, res) => {
  const { id } = req.params
  const { primary_color, secondary_color, third_color, founded_year, logo_url } = req.body

  try {
    // Update entity fields
    const { rows } = await pool.query(`
      UPDATE entities SET
        primary_color   = $1,
        secondary_color = $2,
        third_color     = $3,
        founded_year    = $4,
        updated_at      = NOW()
      WHERE id = $5 AND entity_type = 'club'
      RETURNING id, canonical_name, primary_color, secondary_color, third_color, founded_year
    `, [primary_color || null, secondary_color || null, third_color || null, founded_year || null, id])

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Club not found' })
    }

    // Update logo if provided
    if (logo_url !== undefined) {
      // Check if current logo row exists
      const existing = await pool.query(
        `SELECT id FROM entity_logos WHERE entity_id = $1 AND is_current = true`,
        [id]
      )

      if (existing.rows.length > 0) {
        await pool.query(
          `UPDATE entity_logos SET logo_url = $1 WHERE entity_id = $2 AND is_current = true`,
          [logo_url || null, id]
        )
      } else if (logo_url) {
        await pool.query(
          `INSERT INTO entity_logos (entity_id, logo_url, is_current) VALUES ($1, $2, true)`,
          [id, logo_url]
        )
      }
    }

    res.json({ ...rows[0], logo_url: logo_url ?? null })
  } catch (err) {
    console.error('PUT /admin/clubs/:id error:', err)
    res.status(500).json({ error: err.message })
  }
})
