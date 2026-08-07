const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db     = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

// Alle routes vereisen admin
router.use(requireAdmin);

// GET /api/admin/users — alle gebruikers met stats
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT
      u.id, u.name, u.email, u.role, u.niveau, u.language,
      u.last_seen, u.created_at,
      c.name AS company_name,
      (SELECT COUNT(*) FROM exam_results e WHERE e.user_id = u.id) AS exams_done,
      (SELECT ROUND(AVG(CAST(score AS REAL)/max*100),1)
         FROM exam_results WHERE user_id = u.id) AS exam_avg,
      (SELECT SUM(duration_s) FROM sessions WHERE user_id = u.id) AS total_seconds,
      (SELECT started_at FROM sessions WHERE user_id = u.id
         AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) AS online_since
    FROM users u
    LEFT JOIN companies c ON u.company_id = c.id
    ORDER BY u.last_seen DESC NULLS LAST
  `).all();
  res.json(users);
});

// GET /api/admin/users/:id — detail van 1 gebruiker
router.get('/users/:id', (req, res) => {
  const user = db.prepare('SELECT id,name,email,role,niveau,language,last_seen,created_at FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Niet gevonden' });
  const progress  = db.prepare('SELECT category_id,correct,total FROM progress WHERE user_id=? ORDER BY category_id').all(req.params.id);
  const exams     = db.prepare('SELECT score,max,niveau,sections,taken_at FROM exam_results WHERE user_id=? ORDER BY taken_at DESC LIMIT 50').all(req.params.id);
  const sessions  = db.prepare('SELECT started_at,ended_at,duration_s,ip FROM sessions WHERE user_id=? ORDER BY started_at DESC LIMIT 30').all(req.params.id);
  const log       = db.prepare('SELECT action,data,created_at FROM activity_log WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(req.params.id);
  res.json({ user, progress, exams, sessions, log });
});

// PATCH /api/admin/users/:id — blokkeren, role, naam
router.patch('/users/:id', (req, res) => {
  const allowed = ['role', 'name', 'niveau', 'language', 'company_id'];
  const fields  = Object.keys(req.body).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'Niets om te updaten' });
  const set = fields.map(f => `${f} = ?`).join(', ');
  const vals = fields.map(f => req.body[f]);
  db.prepare(`UPDATE users SET ${set} WHERE id = ?`).run(...vals, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Kan jezelf niet verwijderen' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/admin/users — nieuwe gebruiker aanmaken + invite token
router.post('/users', (req, res) => {
  const { name, email, password, role, niveau, company_id } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Naam, email en wachtwoord vereist' });
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'E-mailadres al in gebruik' });
  const hash = bcrypt.hashSync(password, 10);
  const userId = uuid();
  db.prepare('INSERT INTO users (id,name,email,password_hash,role,niveau,company_id) VALUES (?,?,?,?,?,?,?)')
    .run(userId, name, email.toLowerCase(), hash, role||'student', niveau||'all', company_id||null);
  // Genereer magic link token (7 dagen geldig)
  const token = uuid().replace(/-/g,'') + uuid().replace(/-/g,'');
  db.prepare('INSERT INTO invite_tokens (token, user_id) VALUES (?,?)').run(token, userId);
  res.json({ ok: true, inviteToken: token });
});

// GET /api/admin/companies
router.get('/companies', (req, res) => {
  const companies = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM users WHERE company_id = c.id) AS user_count
    FROM companies c ORDER BY c.name
  `).all();
  res.json(companies);
});

// POST /api/admin/companies
router.post('/companies', (req, res) => {
  const { name, email, seats, plan } = req.body;
  if (!name) return res.status(400).json({ error: 'Naam vereist' });
  db.prepare('INSERT INTO companies (id,name,email,seats,plan) VALUES (?,?,?,?,?)')
    .run(uuid(), name, email||null, seats||10, plan||'trial');
  res.json({ ok: true });
});

// GET /api/admin/stats — dashboard stats
router.get('/stats', (req, res) => {
  const stats = {
    total_users:    db.prepare("SELECT COUNT(*) AS n FROM users WHERE role != 'admin'").get().n,
    online_now:     db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE ended_at IS NULL AND started_at > datetime('now','-2 hours')").get().n,
    blocked:        db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'blocked'").get().n,
    exams_today:    db.prepare("SELECT COUNT(*) AS n FROM exam_results WHERE taken_at > date('now')").get().n,
    avg_score_today:db.prepare("SELECT ROUND(AVG(CAST(score AS REAL)/max*100),1) AS n FROM exam_results WHERE taken_at > date('now')").get().n,
    new_this_week:  db.prepare("SELECT COUNT(*) AS n FROM users WHERE created_at > datetime('now','-7 days')").get().n,
    total_hours:    db.prepare("SELECT ROUND(SUM(duration_s)/3600.0,1) AS n FROM sessions").get().n,
  };
  res.json(stats);
});

// GET /api/admin/log — activiteitslog
router.get('/log', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit)||100, 500);
  const log = db.prepare(`
    SELECT l.action, l.data, l.created_at, l.ip, u.name, u.email
    FROM activity_log l
    LEFT JOIN users u ON l.user_id = u.id
    ORDER BY l.created_at DESC LIMIT ?
  `).all(limit);
  res.json(log);
});

module.exports = router;

// GET /api/admin/users/:id/invite — haal bestaande token op of maak nieuwe
router.get('/users/:id/invite', (req, res) => {
  const user = db.prepare('SELECT id,name FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Gebruiker niet gevonden' });

  // Verwijder verlopen tokens
  db.prepare("DELETE FROM invite_tokens WHERE user_id=? AND expires_at <= datetime('now')").run(req.params.id);

  // Geef bestaande actieve token terug
  const existing = db.prepare(
    "SELECT token, expires_at FROM invite_tokens WHERE user_id=? AND used=0 AND expires_at > datetime('now') ORDER BY expires_at DESC LIMIT 1"
  ).get(req.params.id);

  if (existing) {
    const daysLeft = Math.ceil((new Date(existing.expires_at) - new Date()) / (1000*60*60*24));
    return res.json({ token: existing.token, expiresAt: existing.expires_at, daysLeft });
  }

  // Nieuwe token aanmaken
  const token = uuid().replace(/-/g,'') + uuid().replace(/-/g,'');
  db.prepare('INSERT INTO invite_tokens (token, user_id) VALUES (?,?)').run(token, req.params.id);
  const row = db.prepare('SELECT expires_at FROM invite_tokens WHERE token=?').get(token);
  res.json({ token, expiresAt: row.expires_at, daysLeft: 20 });
});

// POST /api/admin/users/:id/invite/extend — verleng 20 dagen
router.post('/users/:id/invite/extend', (req, res) => {
  // Verwijder oude tokens van deze user
  db.prepare('DELETE FROM invite_tokens WHERE user_id=?').run(req.params.id);
  // Maak nieuwe
  const token = uuid().replace(/-/g,'') + uuid().replace(/-/g,'');
  db.prepare('INSERT INTO invite_tokens (token, user_id) VALUES (?,?)').run(token, req.params.id);
  const row = db.prepare('SELECT expires_at FROM invite_tokens WHERE token=?').get(token);
  res.json({ token, expiresAt: row.expires_at, daysLeft: 20 });
});
