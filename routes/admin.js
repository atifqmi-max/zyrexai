const express = require('express');
const db = require('../db/db');
const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Admin login required' });
  next();
}

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASS) {
    req.session.isAdmin = true;
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid admin credentials' });
});

router.post('/logout', (req, res) => {
  req.session.isAdmin = false;
  res.json({ ok: true });
});

router.get('/stats', requireAdmin, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const totalChats = db.prepare('SELECT COUNT(*) c FROM chats').get().c;
  const totalVisitors = db.prepare('SELECT COUNT(DISTINCT ip) c FROM visits').get().c;
  const openTickets = db.prepare(`SELECT COUNT(*) c FROM support_tickets WHERE status='open'`).get().c;
  res.json({ totalUsers, totalChats, totalVisitors, openTickets });
});

router.get('/users', requireAdmin, (req, res) => {
  const { search } = req.query;
  let users;
  if (search) {
    users = db.prepare(`SELECT id,name,email,is_verified,is_suspended,suspend_reason,created_at FROM users
      WHERE email LIKE ? OR name LIKE ? ORDER BY id DESC`).all(`%${search}%`, `%${search}%`);
  } else {
    users = db.prepare(`SELECT id,name,email,is_verified,is_suspended,suspend_reason,created_at FROM users ORDER BY id DESC`).all();
  }
  res.json({ users });
});

router.get('/users/:id/chats', requireAdmin, (req, res) => {
  const chats = db.prepare('SELECT * FROM chats WHERE user_id=? ORDER BY updated_at DESC').all(req.params.id);
  res.json({ chats });
});

router.get('/chats/:id/messages', requireAdmin, (req, res) => {
  const messages = db.prepare('SELECT * FROM messages WHERE chat_id=? ORDER BY id ASC').all(req.params.id);
  res.json({ messages });
});

router.post('/chats/:id/suspend', requireAdmin, (req, res) => {
  db.prepare('UPDATE chats SET is_suspended=1 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/chats/:id/unsuspend', requireAdmin, (req, res) => {
  db.prepare('UPDATE chats SET is_suspended=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.delete('/chats/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM chats WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/users/:id/suspend', requireAdmin, (req, res) => {
  const { reason } = req.body;
  db.prepare('UPDATE users SET is_suspended=1, suspend_reason=? WHERE id=?').run(reason || 'Violation of terms', req.params.id);
  res.json({ ok: true });
});

router.post('/users/:id/unsuspend', requireAdmin, (req, res) => {
  db.prepare('UPDATE users SET is_suspended=0, suspend_reason=NULL WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.delete('/users/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/support/tickets', requireAdmin, (req, res) => {
  const tickets = db.prepare(`
    SELECT t.*, u.name as user_name, u.email as user_email
    FROM support_tickets t JOIN users u ON u.id = t.user_id
    ORDER BY t.id DESC`).all();
  res.json({ tickets });
});

router.post('/support/tickets/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  db.prepare('UPDATE support_tickets SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
