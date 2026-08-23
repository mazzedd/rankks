const path    = require('path');
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');

const sportsRouter       = require('./routes/sports');
const competitionsRouter = require('./routes/competitions');
const seasonsRouter      = require('./routes/seasons');
const resultsRouter      = require('./routes/results');
const entitiesRouter     = require('./routes/entities');
const mediaRouter        = require('./routes/media');
const regionsRouter      = require('./routes/regions');
const analyticsRouter    = require('./routes/analytics');
const adminRouter        = require('./routes/admin');
const iconicMomentCategoriesRouter = require('./routes/iconicMomentCategories');
const pageSubtitlesRouter = require('./routes/pageSubtitles');
const subtitlesRouter    = require('./routes/subtitles');
const f1Router           = require('./routes/f1');
const motogpRouter       = require('./routes/motogp');
const authRouter         = require('./routes/auth');
const favouritesRouter   = require('./routes/favourites');
const followersRouter    = require('./routes/followers');
const votesRouter        = require('./routes/votes');
const usersRouter        = require('./routes/users');
const videoStatsRouter   = require('./routes/video-stats');
const reportsRouter      = require('./routes/reports');


const app  = express();
const PORT = process.env.PORT || 3000;

// Infomaniak's hosting sits behind a reverse proxy that sets X-Forwarded-For —
// without this, express-rate-limit can't safely resolve the real client IP.
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

const { startScheduler } = require('./scheduler');
startScheduler();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      // UK home nations / French overseas territories have no local flag
      // SVG and intentionally fall back to flagcdn.com (see utils/flags.js).
      'img-src': ["'self'", 'data:', 'https://flagcdn.com'],
    },
  },
}));

app.use(cors({
  origin: [
    process.env.CORS_ORIGIN      || 'http://localhost:5173',
    process.env.CORS_ADMIN_ORIGIN || 'http://localhost:5174',
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use("/api", rateLimit({
   windowMs: 15 * 60 * 1000,
  max: 10000,
  message: { error: 'Too many requests, please try again later.' },
}));

app.use(express.json());

// ── Static media files ────────────────────────────────────────────────────────
app.use('/media', express.static(path.join(__dirname, '..', 'media')));

// ── Public frontend (built by rankks-frontend, copied here at deploy time) ─────
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ── Public API Routes ─────────────────────────────────────────────────────────
app.use('/api/sports',       sportsRouter);
app.use('/api/competitions', competitionsRouter);
app.use('/api/seasons',      seasonsRouter);
app.use('/api/results',      resultsRouter);
app.use('/api/entities',     entitiesRouter);
app.use('/api/media',        mediaRouter);
app.use('/api/regions',      regionsRouter);
app.use('/api/analytics',    analyticsRouter);
app.use('/api/iconic-moment-categories', iconicMomentCategoriesRouter);
app.use('/api/page-subtitles', pageSubtitlesRouter); // TODO(subtitles migration): remove once every consumer is repointed to /api/subtitles
app.use('/api/subtitles',    subtitlesRouter);
app.use('/api/f1',           f1Router);
app.use('/api/motogp',       motogpRouter);
app.use('/api/auth',         authRouter);
app.use('/api/favourites',   favouritesRouter);
app.use('/api/followers',    followersRouter);
app.use('/api/votes',        votesRouter);
app.use('/api/users',        usersRouter);
app.use('/api/video-stats',  videoStatsRouter);
app.use('/api/reports',      reportsRouter);

// ── Admin Routes (JWT protected) ──────────────────────────────────────────────
app.use('/api/admin',        adminRouter);

// ── SPA fallback (client-side routes, e.g. deep links) ──────────────────────────
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/media') || req.path === '/health') {
    return next();
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), (err) => {
    if (err) next();
  });
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('API Error:', err.message);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 RANKKS API running on http://localhost:${PORT}`);
  console.log(`📈 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔧 Health check: http://localhost:${PORT}/health\n`);
});

module.exports = app;