const express = require('express');
const db = require('../db/db');
const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  req.user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
  next();
}

router.post('/tickets', requireAuth, (req, res) => {
  const { category, message } = req.body;
  if (!category || !message) return res.status(400).json({ error: 'Category and message are required' });
  db.prepare('INSERT INTO support_tickets (user_id, category, message) VALUES (?,?,?)')
    .run(req.user.id, category, message);
  res.json({ ok: true, message: 'Support request submitted' });
});

router.get('/tickets', requireAuth, (req, res) => {
  const tickets = db.prepare('SELECT * FROM support_tickets WHERE user_id=? ORDER BY id DESC').all(req.user.id);
  res.json({ tickets });
});

module.exports = router;
