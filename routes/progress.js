const router = require('express').Router();
const { v4: uuid } = require('uuid');
const db     = require('../db/database');
const { requireAuth } = require('../middleware/auth');

// POST /api/progress/sync — quiz stuurt periodiek voortgang
router.post('/sync', requireAuth, (req, res) => {
  const { categories, sessionMinutes } = req.body;
  const userId = req.user.id;

  const upsert = db.prepare(`
    INSERT INTO progress (id, user_id, category_id, correct, total, last_answer)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, category_id) DO UPDATE SET
      correct     = excluded.correct,
      total       = excluded.total,
      last_answer = excluded.last_answer
  `);

  const syncMany = db.transaction((cats) => {
    for (const [catId, data] of Object.entries(cats)) {
      upsert.run(uuid(), userId, catId, data.correct || 0, data.total || 0);
    }
  });

  if (categories) syncMany(categories);

  // Sessieduur bijwerken
  if (sessionMinutes > 0) {
    const sess = db.prepare("SELECT id FROM sessions WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1").get(userId);
    if (sess) {
      db.prepare("UPDATE sessions SET duration_s = ? WHERE id = ?").run(sessionMinutes * 60, sess.id);
    }
  }

  res.json({ ok: true });
});

// POST /api/progress/exam — examenresultaat opslaan
router.post('/exam', requireAuth, (req, res) => {
  const { score, max, niveau, sections } = req.body;
  db.prepare('INSERT INTO exam_results (id, user_id, score, max, niveau, sections) VALUES (?,?,?,?,?,?)')
    .run(uuid(), req.user.id, score, max, niveau || 'all', JSON.stringify(sections || {}));
  db.prepare("INSERT INTO activity_log (id, user_id, action, data) VALUES (?,?,?,?)")
    .run(uuid(), req.user.id, 'exam_done', JSON.stringify({ score, max, niveau }));
  res.json({ ok: true });
});

// GET /api/progress/me — haal eigen voortgang op
router.get('/me', requireAuth, (req, res) => {
  const progress = db.prepare('SELECT category_id, correct, total FROM progress WHERE user_id = ?').all(req.user.id);
  const exams    = db.prepare('SELECT score, max, niveau, sections, taken_at FROM exam_results WHERE user_id = ? ORDER BY taken_at DESC LIMIT 20').all(req.user.id);
  res.json({ progress, exams });
});

module.exports = router;
