const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

const DB_PATH  = path.join(__dirname, '..', 'data', 'vaarbewijs.db');
const SQL_PATH = path.join(__dirname, 'schema.sql');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

// WAL mode + foreign keys
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Schema toepassen
const schema = fs.readFileSync(SQL_PATH, 'utf8');
db.exec(schema);

// Helper: maak prepare compatible met better-sqlite3 API
// node:sqlite prepare() returns statements with .run()/.get()/.all()
module.exports = db;
