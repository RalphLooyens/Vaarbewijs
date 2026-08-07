const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const token = req.cookies?.vb_token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Niet ingelogd' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Sessie verlopen, log opnieuw in' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Geen toegang' });
    next();
  });
}

module.exports = { requireAuth, requireAdmin };
