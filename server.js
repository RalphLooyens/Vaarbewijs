require('dotenv').config();
const express      = require('express');
const cookieParser = require('cookie-parser');
const cors         = require('cors');
const path         = require('path');
const bcrypt       = require('bcryptjs');
const { v4: uuid } = require('uuid');

const db           = require('./db/database');
const authRoutes   = require('./routes/auth');
const progressRoutes = require('./routes/progress');
const adminRoutes  = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// ── API routes ────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/admin',    adminRoutes);

// ── Statische bestanden ───────────────────────────────────────
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use(express.static(path.join(__dirname, 'public')));

// ── Quiz route (vereist ingelogd zijn) ────────────────────────
app.get('/quiz', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'quiz.html'));
});

// ── Admin panel ───────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

// ── Root redirect ─────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/quiz'));
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ── Eerste keer: admin-account aanmaken als er nog geen is ────
function ensureAdmin() {
  const existing = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!existing) {
    const email = process.env.ADMIN_EMAIL || 'admin@vaarbewijs.be';
    const pass  = process.env.ADMIN_PASSWORD || 'Admin1234!';
    const hash  = bcrypt.hashSync(pass, 10);
    db.prepare('INSERT INTO users (id,name,email,password_hash,role) VALUES (?,?,?,?,?)')
      .run(uuid(), 'Beheerder', email, hash, 'admin');
    console.log(`\n✅ Admin aangemaakt: ${email} / ${pass}`);
    console.log('⚠️  Wijzig het wachtwoord na je eerste login!\n');
  }
}

ensureAdmin();

app.listen(PORT, () => {
  console.log(`\n🚢 Vaarbewijs server draait op http://localhost:${PORT}`);
  console.log(`   Quiz:        http://localhost:${PORT}/quiz`);
  console.log(`   Admin panel: http://localhost:${PORT}/admin\n`);
});

// ── Magic link (uitnodigingslink) ─────────────────────────────
app.get('/invite/:token', (req, res) => {
  const jwt    = require('jsonwebtoken');
  const { v4: uid } = require('uuid');

  const row = db.prepare(
    "SELECT * FROM invite_tokens WHERE token=? AND used=0 AND expires_at > datetime('now')"
  ).get(req.params.token);

  if (!row) return res.send(`
    <html><body style="font-family:sans-serif;text-align:center;padding:60px">
    <h2>❌ Link ongeldig of verlopen</h2>
    <p>Contacteer de beheerder voor een nieuwe link.</p>
    </body></html>`);

  const user = db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
  if (!user || user.role === 'blocked') return res.send(`
    <html><body style="font-family:sans-serif;text-align:center;padding:60px">
    <h2>❌ Account niet beschikbaar</h2></body></html>`);

  // Token als gebruikt markeren
  db.prepare('UPDATE invite_tokens SET used=1 WHERE token=?').run(row.token);

  // Sessie aanmaken
  const sessionId = uid();
  db.prepare('INSERT INTO sessions (id, user_id, ip, user_agent) VALUES (?,?,?,?)')
    .run(sessionId, user.id, req.ip, req.headers['user-agent']);
  db.prepare("INSERT INTO activity_log (id, user_id, action, ip) VALUES (?,?,?,?)")
    .run(uid(), user.id, 'login', req.ip);
  db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id=?").run(user.id);

  // JWT cookie zetten
  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role, sessionId },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.cookie('vb_token', token, {
    httpOnly: true, sameSite: 'lax',
    maxAge: 7*24*60*60*1000,
    secure: process.env.NODE_ENV === 'production'
  });
  res.redirect('/quiz');
});
