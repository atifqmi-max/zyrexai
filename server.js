require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const db = require('./db/db');

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/generated', express.static(path.join(__dirname, 'generated')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'zyrex_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 days
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
