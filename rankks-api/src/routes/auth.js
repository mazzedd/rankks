const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { queryOne } = require('../db');
const userAuth = require('../middleware/userAuth');

const PUBLIC_USER_FIELDS = `id, email, display_name, subscription_tier, show_odds_data, created_at`;

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// POST /api/auth/signup
router.post('/signup', async (req, res, next) => {
  try {
    const { email, password, display_name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await queryOne(`SELECT id FROM users WHERE email = $1`, [normalizedEmail]);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = await queryOne(`
      INSERT INTO users (email, password_hash, display_name)
      VALUES ($1, $2, $3)
      RETURNING ${PUBLIC_USER_FIELDS}
    `, [normalizedEmail, password_hash, display_name || null]);

    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const row = await queryOne(`
      SELECT ${PUBLIC_USER_FIELDS}, password_hash FROM users WHERE email = $1 AND is_active = TRUE
    `, [email.toLowerCase().trim()]);

    if (!row || !row.password_hash || !(await bcrypt.compare(password, row.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    await queryOne(`UPDATE users SET last_login_at = now() WHERE id = $1 RETURNING id`, [row.id]);

    const { password_hash, ...user } = row;
    res.json({ token: signToken(user), user });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
router.get('/me', userAuth, async (req, res, next) => {
  try {
    const user = await queryOne(`SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE id = $1`, [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ data: user });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
