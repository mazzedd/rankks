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
const f1Router           = require('./routes/f1');


const app  = express();
const PORT = process.env.PORT || 3000;

const { startScheduler } = require('./scheduler');
startScheduler();

app.use(helmet());

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
app.use('/api/f1',           f1Router);

// ── Admin Routes (JWT protected) ──────────────────────────────────────────────
app.use('/api/admin',        adminRouter);

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