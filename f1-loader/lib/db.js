// lib/db.js
// Set DATABASE_URL before running, e.g. (Windows CMD):
//   set DATABASE_URL=postgres://user:password@localhost:5432/rankks
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Run: set DATABASE_URL=postgres://user:pass@localhost:5432/dbname');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = { pool };
