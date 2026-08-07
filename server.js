require('dotenv').config();
const express = require('express');
const path    = require('path');
const db      = require('./db/database');

const app           = express();
const PORT          = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(express.json({ limit: '10mb' }));

// ── Statische bestanden ───────────────────────────────────────
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use(express.static(path.join(__dirname, 'public')));

// ── Hoofd-routes ──────────────────────────────────────────────
app.get('/quiz', (req, res) => res.sendFile(path.join(__dirname, 'public', 'quiz.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));
app.get('/admin/*', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));
app.get('/',  (req, res) => res.redirect('/quiz'));
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── Gebruiker ophalen via code ────────────────────────────────
app.get('/api/user/:code', (req, res) => {
  const user = db.prepare(`
    SELECT code, name, expires_at FROM link_users WHERE code = ?
  `).get(req.params.code);

  if (!user) return res.status(404).json({ error: 'Niet gevonden' });
  const days_left = Math.floor((new Date(user.expires_at).getTime() - Date.now()) / 86400000);
  if (days_left < 0) return res.status(410).json({ error: 'Link verlopen', expired: true, name: user.name });

  res.json({ ...user, days_left });
});

// ── Voortgang synchroniseren ──────────────────────────────────
app.post('/api/sync', (req, res) => {
  const { code, data } = req.body;
  if (!code || !data) return res.status(400).json({ error: 'code en data vereist' });

  const user = db.prepare(
    "SELECT code FROM link_users WHERE code = ? AND expires_at > datetime('now')"
  ).get(code);
  if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden of link verlopen' });

  db.prepare(`
    INSERT INTO link_progress (code, data, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(code) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(code, typeof data === 'string' ? data : JSON.stringify(data));

  res.json({ ok: true });
});

app.get('/api/sync/:code', (req, res) => {
  const row = db.prepare('SELECT data, updated_at FROM link_progress WHERE code = ?').get(req.params.code);
  if (!row) return res.json({ data: null });
  try { res.json({ data: JSON.parse(row.data), updated_at: row.updated_at }); }
  catch(e) { res.json({ data: null }); }
});

// ── Admin middleware ──────────────────────────────────────────
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (key !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Geen toegang' });
  next();
}

// ── Admin: gebruikers ophalen ─────────────────────────────────
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT u.code, u.name, u.expires_at, u.created_at,
           p.updated_at AS last_sync, p.data AS progress_data
    FROM link_users u
    LEFT JOIN link_progress p ON u.code = p.code
    ORDER BY u.created_at DESC
  `).all();
  const now = Date.now();
  const users = rows.map(u => ({
    ...u,
    days_left: Math.floor((new Date(u.expires_at).getTime() - now) / 86400000)
  }));
  res.json(users);
});

// ── Admin: gebruiker aanmaken ─────────────────────────────────
app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { name, days } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Naam vereist' });

  const validDays = Math.min(Math.max(parseInt(days) || 90, 1), 730);
  const code = generateCode();

  db.prepare(`
    INSERT INTO link_users (code, name, expires_at)
    VALUES (?, ?, datetime('now', '+' || ? || ' days'))
  `).run(code, name.trim(), validDays);

  res.json({ code, name: name.trim(), days: validDays });
});

// ── Admin: link verlengen ─────────────────────────────────────
app.patch('/api/admin/users/:code/extend', requireAdmin, (req, res) => {
  const { days } = req.body;
  const validDays = Math.min(Math.max(parseInt(days) || 90, 1), 730);

  const user = db.prepare('SELECT code, expires_at FROM link_users WHERE code = ?').get(req.params.code);
  if (!user) return res.status(404).json({ error: 'Niet gevonden' });

  // Verleng vanuit vandaag of huidige vervaldatum (whichever is later)
  db.prepare(`
    UPDATE link_users
    SET expires_at = datetime(MAX(expires_at, datetime('now')), '+' || ? || ' days')
    WHERE code = ?
  `).run(validDays, req.params.code);

  const updated = db.prepare(`
    SELECT expires_at FROM link_users WHERE code = ?
  `).get(req.params.code);
  updated.days_left = Math.floor((new Date(updated.expires_at).getTime() - Date.now()) / 86400000);

  res.json({ ok: true, expires_at: updated.expires_at, days_left: updated.days_left });
});

// ── Admin: gebruiker verwijderen ──────────────────────────────
app.delete('/api/admin/users/:code', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM link_users WHERE code = ?').run(req.params.code);
  res.json({ ok: true });
});

// ── Hulpfunctie: unieke code genereren ───────────────────────
function generateCode() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let code;
  do {
    code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (db.prepare('SELECT 1 FROM link_users WHERE code = ?').get(code));
  return code;
}

app.listen(PORT, () => {
  console.log(`\n🚢 Vaarbewijs server op http://localhost:${PORT}`);
  console.log(`   Quiz:  http://localhost:${PORT}/quiz`);
  console.log(`   Admin: http://localhost:${PORT}/admin\n`);
});
