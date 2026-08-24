require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const db = require('./db/db');

// Persistent, database-backed session store.
// Without this, sessions live only in server memory and are wiped on every
// restart/deploy - logging everyone out. This keeps people logged in across
// restarts, refreshes, and updates.
class SqliteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.db = database;
  }
  get(sid, cb) {
    try {
      const row = this.db.prepare('SELECT sess, expires FROM sessions WHERE sid=?').get(sid);
      if (!row) return cb(null, null);
      if (row.expires && row.expires < Date.now()) {
        this.db.prepare('DELETE FROM sessions WHERE sid=?').run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    } catch (err) { cb(err); }
  }
  set(sid, sess, cb) {
    try {
      const expires = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + 1000 * 60 * 60 * 24 * 7;
      this.db.prepare(
        `INSERT INTO sessions (sid, sess, expires) VALUES (?,?,?)
         ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expires=excluded.expires`
      ).run(sid, JSON.stringify(sess), expires);
      cb && cb(null);
    } catch (err) { cb && cb(err); }
  }
  destroy(sid, cb) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid=?').run(sid);
      cb && cb(null);
    } catch (err) { cb && cb(err); }
  }
  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }
}

const app = express();
app.set('trust proxy', 1); // needed for correct cookies when behind Cloudflare Tunnel / a reverse proxy
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/generated', express.static(path.join(__dirname, 'generated')));

app.use(session({
  store: new SqliteSessionStore(db),
  secret: process.env.SESSION_SECRET || 'zyrex_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    sameSite: 'lax',
    secure: false
  }
}));

// simple visitor counter (distinct ip per day)
app.use((req, res, next) => {
  try { db.prepare('INSERT OR IGNORE INTO visits (ip) VALUES (?)').run(req.ip); } catch (e) {}
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/chat'));
app.use('/api/support', require('./routes/support'));
app.use('/api/admin', require('./routes/admin'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Safety net: log unexpected errors instead of crashing the whole server
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => console.log(`ZyreX running on port ${PORT}`));
