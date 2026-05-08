// db.js — PostgreSQL connection for ingestion scripts
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'rankks',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

const query    = (text, params) => pool.query(text, params);
const queryOne = async (text, params) => { const r = await pool.query(text, params); return r.rows[0] || null; };
const queryAll = async (text, params) => { const r = await pool.query(text, params); return r.rows; };
const end      = () => pool.end();

module.exports = { pool, query, queryOne, queryAll, end };
