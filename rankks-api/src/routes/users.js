const express  = require('express');
const router   = express.Router();
const { queryOne } = require('../db');
const userAuth = require('../middleware/userAuth');

// PATCH /api/users/:id/preferences — body: { show_odds_data }
router.patch('/:id/preferences', userAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (id !== req.user.id) {
      return res.status(403).json({ error: "Cannot modify another user's preferences" });
    }

    const { show_odds_data } = req.body;
    if (typeof show_odds_data !== 'boolean') {
      return res.status(400).json({ error: 'show_odds_data must be a boolean' });
    }

    const user = await queryOne(`
      UPDATE users SET show_odds_data = $1, updated_at = now()
      WHERE id = $2
      RETURNING id, email, display_name, subscription_tier, show_odds_data
    `, [show_odds_data, id]);

    res.json({ data: user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
