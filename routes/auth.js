const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db      = require('../db/database');

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000,  // 7 dagen
  secure:   process.env.NODE_ENV === 'production'
};

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email en wachtwoord vereist' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Onbekend e-mailadres' });
  if (user.role === 'blocked') return res.status(403).json({ error: 'Je account is geblokkeerd. Contacteer de beheerder.' });

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Onjuist wachtwoord' });

  // Sessie aanmaken
  const sessionId = uuid();
  db.prepare('INSERT INTO sessions (id, user_id, ip, user_agent) VALUES (?,?,?,?)')
    .run(sessionId, user.id, req.ip, req.headers['user-agent']);

  // Activiteitslog
  db.prepare("INSERT INTO activity_log (id, user_id, action, ip) VALUES (?,?,?,?)")
    .run(uuid(), user.id, 'login', req.ip);

  // Last seen bijwerken
  db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(user.id);

  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role, sessionId },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.cookie('vb_token', token, COOKIE_OPTS);
  res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, niveau: user.niveau } });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const token = req.cookies?.vb_token;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Sessie afsluiten + duur berekenen
      const sess = db.prepare('SELECT started_at FROM sessions WHERE id = ?').get(decoded.sessionId);
      if (sess) {
        const dur = Math.round((Date.now() - new Date(sess.started_at).getTime()) / 1000);
        db.prepare("UPDATE sessions SET ended_at = datetime('now'), duration_s = ? WHERE id = ?")
          .run(dur, decoded.sessionId);
      }
      db.prepare("INSERT INTO activity_log (id, user_id, action, ip) VALUES (?,?,?,?)")
        .run(uuid(), decoded.id, 'logout', req.ip);
    } catch {}
  }
  res.clearCookie('vb_token');
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  const token = req.cookies?.vb_token;
  if (!token) return res.status(401).json({ error: 'Niet ingelogd' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare('SELECT id, name, email, role, niveau, language FROM users WHERE id = ?').get(decoded.id);
    if (!user || user.role === 'blocked') {
      res.clearCookie('vb_token');
      return res.status(403).json({ error: 'Account geblokkeerd of verwijderd' });
    }
    db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(user.id);
    res.json(user);
  } catch {
    res.clearCookie('vb_token');
    res.status(401).json({ error: 'Sessie verlopen' });
  }
});

module.exports = router;

// POST /api/auth/change-password  (ingelogd vereist)
router.post('/change-password', (req, res) => {
  const token = req.cookies?.vb_token;
  if (!token) return res.status(401).json({ error: 'Niet ingelogd' });
  let decoded;
  try { decoded = jwt.verify(token, process.env.JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Sessie verlopen' }); }

  const { current, newPass } = req.body;
  if (!current || !newPass) return res.status(400).json({ error: 'Vul alle velden in' });
  if (newPass.length < 8) return res.status(400).json({ error: 'Nieuw wachtwoord min. 8 tekens' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
  if (!bcrypt.compareSync(current, user.password_hash))
    return res.status(401).json({ error: 'Huidig wachtwoord klopt niet' });

  const hash = bcrypt.hashSync(newPass, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, decoded.id);
  res.json({ ok: true });
});
