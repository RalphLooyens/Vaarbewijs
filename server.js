require('dotenv').config();
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const db      = require('./db/database');

const compression   = require('compression');
const jwt           = require('jsonwebtoken');
const app           = express();
const JWT_SECRET    = process.env.JWT_SECRET || process.env.ADMIN_PASSWORD || 'vb_default_secret';

// ── Gzip-compressie ───────────────────────────────────────────
app.use(compression());
const PORT          = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(express.json({ limit: '10mb' }));

// ── Statische bestanden ───────────────────────────────────────
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use(express.static(path.join(__dirname, 'public')));

// ── Hoofd-routes ──────────────────────────────────────────────
app.get('/quiz', (req, res) => {
  // Als ?u= aanwezig is maar GEEN ?_c=1: stuur eerst een mini auth-pagina (2KB)
  // die de server wakker houdt en automatisch retry doet. Pas daarna laadt de quiz (5MB).
  if (req.query.u && !req.query._c) {
    const token = req.query.u;
    const splash = `<!DOCTYPE html><html><head>
<meta charset="utf-8"><title>Vaarbewijs</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,sans-serif;
     display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:20px;padding:32px 24px;max-width:320px;width:90%;
      text-align:center;box-shadow:0 2px 20px rgba(0,0,0,.07)}
.icon{font-size:36px;margin-bottom:14px}
h2{font-size:17px;font-weight:700;color:#1C1C1E;margin-bottom:8px}
p{font-size:13px;color:#8E8E93;line-height:1.5;min-height:1.5em}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#007AFF;
     margin:16px 3px 0;animation:b 1.2s infinite both}
.dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}
@keyframes b{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}
</style></head><body>
<div class="card">
  <div class="icon">&#9875;</div>
  <h2>Vaarbewijs</h2>
  <p id="msg">Link wordt gecontroleerd&hellip;</p>
  <div><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
</div>
<script>
var code = ${JSON.stringify(token)};
var attempts = 0;
function check() {
  fetch('/api/user/' + encodeURIComponent(code))
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, s:r.status, d:d}; }); })
    .then(function(r) {
      if (r.ok) {
        // Cache opslaan zodat quiz direct inlogt zonder extra API-call
        try { localStorage.setItem('vb_link_' + code, JSON.stringify({name:r.d.name, ts:Date.now()})); } catch(e){}
        // Stuur door naar de echte quiz
        window.location.replace('/quiz?u=' + encodeURIComponent(code) + '&_c=1');
      } else {
        var dots = document.querySelector('div:last-child');
        if (dots) dots.style.display = 'none';
        document.getElementById('msg').style.color = '#FF3B30';
        document.getElementById('msg').textContent =
          r.s === 410 ? 'Link is verlopen. Vraag een nieuwe link aan.' :
          r.s === 403 ? 'Link is geblokkeerd. Neem contact op met de beheerder.' :
          'Ongeldige link. Controleer de URL.';
      }
    })
    .catch(function() {
      attempts++;
      document.getElementById('msg').textContent =
        'Server start op… (' + attempts + 's' + (attempts === 1 ? '' : '') + ')';
      setTimeout(check, 3000);
    });
}
check();
</script></body></html>`;
    return res.send(splash);
  }
  res.sendFile(path.join(__dirname, 'public', 'quiz.html'));
});
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));
app.get('/admin/*', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));
app.get('/', (req, res) => { const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''; res.redirect('/quiz' + qs); });
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ── Gebruiker ophalen via code (JWT of legacy short code) ────────────────────────────────
app.get('/api/user/:code', (req, res) => {
  const code = req.params.code;

  // JWT-token: bevat naam + verloopdatum — werkt ook na database-reset
  if (code.includes('.')) {
    try {
      const payload = jwt.verify(code, JWT_SECRET);
      // Controleer blocklist (best-effort, mag falen als DB leeg is)
      try {
        const dbUser = db.prepare('SELECT blocked FROM link_users WHERE code = ?').get(code);
        if (dbUser && dbUser.blocked) return res.status(403).json({ error: 'Link geblokkeerd', name: payload.name });
      } catch(e) {}
      const days_left = Math.floor((payload.exp * 1000 - Date.now()) / 86400000);
      return res.json({ code, name: payload.name, expires_at: new Date(payload.exp * 1000).toISOString(), days_left });
    } catch(e) {
      if (e.name === 'TokenExpiredError') return res.status(410).json({ error: 'Link verlopen', expired: true, name: '' });
      return res.status(404).json({ error: 'Ongeldige link' });
    }
  }

  // Legacy: korte code → database opzoeken
  const user = db.prepare('SELECT code, name, expires_at, blocked FROM link_users WHERE code = ?').get(code);
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

  // JWT tokens zijn altijd geldig als ze niet verlopen zijn; korte codes via DB
  let validUser = true;
  if (!code.includes('.')) {
    const dbUser = db.prepare("SELECT code FROM link_users WHERE code = ? AND expires_at > datetime('now')").get(code);
    if (!dbUser) validUser = false;
  } else {
    try { jwt.verify(code, JWT_SECRET); } catch(e) { validUser = false; }
  }
  if (!validUser) return res.status(404).json({ error: 'Gebruiker niet gevonden of link verlopen' });

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
  const trimmedName = name.trim();

  // Genereer JWT-token: naam zit in de token, werkt ook na database-reset
  const code = jwt.sign({ name: trimmedName }, JWT_SECRET, { expiresIn: validDays * 24 * 60 * 60 });
  const expiresAt = new Date(Date.now() + validDays * 86400000).toISOString();

  // Sla ook op in DB voor admin-overzicht en blokkeer-functie (best-effort)
  try {
    db.prepare(`INSERT INTO link_users (code, name, expires_at) VALUES (?, ?, ?)`).run(code, trimmedName, expiresAt);
  } catch(e) {}

  res.json({ code, name: trimmedName, days: validDays });
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


// ── Admin: analytics stats ────────────────────────────────────
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const now = Date.now();
  const week_ago = new Date(now - 7 * 86400000).toISOString();

  const users = db.prepare(`
    SELECT u.code, u.name, u.created_at, u.expires_at, u.blocked,
           p.data AS progress_data, p.updated_at AS last_sync
    FROM link_users u
    LEFT JOIN link_progress p ON u.code = p.code
  `).all();

  let totalVragen = 0, totalCorrect = 0;
  const catScores = {}; // catId -> {correct, total}
  const dagActivity = {}; // dateStr -> aantal gebruikers actief
  let activeThisWeek = 0;
  let expiringSoon = 0;
  const userStats = [];

  for (const u of users) {
    const expiresAt = new Date(u.expires_at).getTime();
    const daysLeft = Math.floor((expiresAt - now) / 86400000);
    if (daysLeft >= 0 && daysLeft <= 14) expiringSoon++;

    let userVragen = 0, userCorrect = 0, voortgangPct = 0;
    let lastActive = u.last_sync || u.created_at;

    if (u.progress_data) {
      try {
        const d = JSON.parse(u.progress_data);
        // correct per category
        if (d.correct) {
          for (const [cat, cnt] of Object.entries(d.correct)) {
            userCorrect += cnt;
            if (!catScores[cat]) catScores[cat] = { correct: 0, total: 0 };
            catScores[cat].correct += cnt;
          }
        }
        // fouten per category
        if (d.fouten) {
          for (const [cat, qs] of Object.entries(d.fouten)) {
            const foutCount = Object.keys(qs).length;
            if (!catScores[cat]) catScores[cat] = { correct: 0, total: 0 };
            catScores[cat].total += foutCount;
            userVragen += foutCount;
          }
        }
        // voortgang
        if (d.voortgang) {
          const vals = Object.values(d.voortgang).filter(v => v > 0);
          voortgangPct = vals.length ? Math.round(vals.reduce((a,b) => a+b, 0) / vals.length) : 0;
        }
        // dagStats
        if (d.dagStats) {
          for (const [dag, stats] of Object.entries(d.dagStats)) {
            if (!dagActivity[dag]) dagActivity[dag] = 0;
            if ((stats.vragen || 0) > 0) dagActivity[dag]++;
          }
        }
      } catch(e) {}
    }

    userVragen += userCorrect;
    totalVragen += userVragen;
    totalCorrect += userCorrect;

    if (u.last_sync && u.last_sync >= week_ago) activeThisWeek++;

    userStats.push({
      code: u.code,
      name: u.name,
      created_at: u.created_at,
      days_left: daysLeft,
      blocked: u.blocked,
      last_sync: u.last_sync,
      voortgang_pct: voortgangPct,
      vragen_beantwoord: userVragen,
      correct: userCorrect
    });
  }

  // Top categorieën
  const topCats = Object.entries(catScores)
    .map(([cat, s]) => ({ cat, correct: s.correct, total: s.correct + s.total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  res.json({
    summary: {
      total: users.length,
      active_this_week: activeThisWeek,
      blocked: users.filter(u => u.blocked).length,
      expiring_soon: expiringSoon,
      total_vragen: totalVragen,
      total_correct: totalCorrect
    },
    users: userStats.sort((a, b) => (b.last_sync || '').localeCompare(a.last_sync || '')),
    top_cats: topCats,
    dag_activity: dagActivity
  });
});


app.listen(PORT, () => {
  console.log(`\n🚢 Vaarbewijs server op http://localhost:${PORT}`);
  console.log(`   Quiz:  http://localhost:${PORT}/quiz`);
  console.log(`   Admin: http://localhost:${PORT}/admin\n`);
});
