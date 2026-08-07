require('dotenv').config();
const express = require('express');
const fs      = require('fs');
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
  if (user.blocked) return res.status(403).json({ error: 'Link geblokkeerd', blocked: true, name: user.name });
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
    SELECT u.code, u.name, u.expires_at, u.created_at, u.blocked,
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


// ── Admin: gebruiker blokkeren/deblokkeren ────────────────────
app.patch('/api/admin/users/:code/block', requireAdmin, (req, res) => {
  const { blocked } = req.body;
  const user = db.prepare('SELECT code FROM link_users WHERE code = ?').get(req.params.code);
  if (!user) return res.status(404).json({ error: 'Niet gevonden' });
  db.prepare('UPDATE link_users SET blocked = ? WHERE code = ?').run(blocked ? 1 : 0, req.params.code);
  res.json({ ok: true, blocked: !!blocked });
});


// ── Doorverwijzing (bezoeker stelt vriend voor) ───────────────
app.post('/api/referral', (req, res) => {
  const { code, friend_name, friend_info } = req.body;
  if (!code || !friend_name) return res.status(400).json({ error: 'code en friend_name vereist' });
  const user = db.prepare("SELECT code FROM link_users WHERE code = ? AND expires_at > datetime('now') AND blocked = 0").get(code);
  if (!user) return res.status(404).json({ error: 'Ongeldige link' });
  db.prepare('INSERT INTO link_referrals (referrer_code, friend_name, friend_info) VALUES (?, ?, ?)').run(code, friend_name.trim(), friend_info || '');
  res.json({ ok: true });
});

// ── Admin: doorverwijzingen ophalen ──────────────────────────
app.get('/api/admin/referrals', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.friend_name, r.friend_info, r.created_at,
           u.name AS referrer_name
    FROM link_referrals r
    JOIN link_users u ON r.referrer_code = u.code
    ORDER BY r.created_at DESC
  `).all();
  res.json(rows);
});

// ── Admin: doorverwijzing verwijderen ─────────────────────────
app.delete('/api/admin/referrals/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM link_referrals WHERE id = ?').run(req.params.id);
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

// ── Admin: PDF-kaarten uploaden ───────────────────────────────
const ALLOWED_PDFS = [
  'Examenkaart+Klein+Vaarbewijs+A1.pdf',
  'Examenkaart+Klein+Vaarbewijs+B1.pdf',
  '1775737081-cheat-sheet-kv1.pdf',
  '1779111984-kv2-cheat-sheet-oefenbijlage-v3.pdf'
];
app.post('/api/admin/upload-pdf', requireAdmin, express.json({ limit: '25mb' }), (req, res) => {
  const { filename, data } = req.body;
  if (!filename || !data) return res.status(400).json({ error: 'filename en data vereist' });
  if (!ALLOWED_PDFS.includes(filename)) return res.status(400).json({ error: 'Ongeldig bestand' });
  const dir = path.join(__dirname, 'public', '_BEELDEN', 'Overige');
  fs.mkdirSync(dir, { recursive: true });
  const buf = Buffer.from(data, 'base64');
  fs.writeFileSync(path.join(dir, filename), buf);
  res.json({ ok: true, bytes: buf.length });
});


app.listen(PORT, () => {
  console.log(`\n🚢 Vaarbewijs server op http://localhost:${PORT}`);
  console.log(`   Quiz:  http://localhost:${PORT}/quiz`);
  console.log(`   Admin: http://localhost:${PORT}/admin\n`);
});
