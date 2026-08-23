const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/db');
const { genOtp, genToken, sendMail, otpEmailHtml, resetEmailHtml } = require('../utils');

const router = express.Router();
const OTP_TTL_MIN = 10;
const RESET_TTL_MIN = 30;
const RESEND_COOLDOWN_SEC = 60;

function getDeviceToken(req, res) {
  let token = req.cookies.device_token;
  if (!token) {
    token = genToken();
    res.cookie('device_token', token, { maxAge: 1000 * 60 * 60 * 24 * 365, httpOnly: true });
  }
  return token;
}

function canResend(userId, type) {
  const last = db.prepare(
    `SELECT created_at FROM otp_codes WHERE user_id=? AND type=? ORDER BY id DESC LIMIT 1`
  ).get(userId, type);
  if (!last) return true;
  const lastTime = new Date(last.created_at + 'Z').getTime();
  return Date.now() - lastTime > RESEND_COOLDOWN_SEC * 1000;
}

async function issueOtp(user, type, deviceToken = null) {
  const code = genOtp();
  const expires = new Date(Date.now() + OTP_TTL_MIN * 60000).toISOString();
  db.prepare(
    `INSERT INTO otp_codes (user_id, code, type, device_token, expires_at) VALUES (?,?,?,?,?)`
  ).run(user.id, code, type, deviceToken, expires);
  const purpose = type === 'register' ? 'account verification' : 'new device login';
  await sendMail(user.email, 'ZyreX Verification Code', otpEmailHtml(code, purpose));
}

// ---------- REGISTER ----------
router.post('/register', async (req, res) => {
  const { name, email, password, confirmPassword } = req.body;
  if (!name || !email || !password || !confirmPassword)
    return res.status(400).json({ error: 'All fields are required' });
  if (password !== confirmPassword)
    return res.status(400).json({ error: 'Passwords do not match' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const existing = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (existing && existing.is_verified)
    return res.status(400).json({ error: 'Account already exists, please login' });

  const hash = await bcrypt.hash(password, 10);
  let user;
  if (existing) {
    db.prepare('UPDATE users SET name=?, password_hash=? WHERE id=?').run(name, hash, existing.id);
    user = existing;
  } else {
    const info = db.prepare(
      'INSERT INTO users (name, email, password_hash) VALUES (?,?,?)'
    ).run(name, email, hash);
    user = { id: info.lastInsertRowid, email };
  }

  try {
    await issueOtp(user, 'register');
  } catch (err) {
    console.error('Email send failed:', err.message);
    return res.status(500).json({ error: 'Could not send verification email. Check SMTP settings in .env and try again.' });
  }
  res.json({ ok: true, email: user.email, message: 'Verification code sent to your email' });
});

router.post('/verify-register', async (req, res) => {
  const { email, code } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user) return res.status(400).json({ error: 'Account not found' });

  const otp = db.prepare(
    `SELECT * FROM otp_codes WHERE user_id=? AND type='register' AND code=? AND used=0 ORDER BY id DESC LIMIT 1`
  ).get(user.id, code);
  if (!otp) return res.status(400).json({ error: 'Invalid code' });
  if (new Date(otp.expires_at + 'Z').getTime() < Date.now())
    return res.status(400).json({ error: 'Code expired, please resend' });

  db.prepare('UPDATE otp_codes SET used=1 WHERE id=?').run(otp.id);
  db.prepare('UPDATE users SET is_verified=1 WHERE id=?').run(user.id);

  const deviceToken = getDeviceToken(req, res);
  db.prepare(
    `INSERT OR REPLACE INTO devices (id, user_id, device_token, ip, user_agent, verified, last_login)
     VALUES ((SELECT id FROM devices WHERE user_id=? AND device_token=?), ?, ?, ?, ?, 1, datetime('now'))`
  ).run(user.id, deviceToken, user.id, deviceToken, req.ip, req.headers['user-agent']);

  req.session.userId = user.id;
  res.json({ ok: true, message: 'Account verified, logging in...' });
});

router.post('/resend-otp', async (req, res) => {
  const { email, type } = req.body; // type: register | new_device | reset
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user) return res.status(400).json({ error: 'Account not found' });
  if (!canResend(user.id, type || 'register'))
    return res.status(429).json({ error: `Please wait before resending. Cooldown is ${RESEND_COOLDOWN_SEC}s.` });
  try {
    await issueOtp(user, type || 'register', req.cookies.device_token);
  } catch (err) {
    console.error('Email send failed:', err.message);
    return res.status(500).json({ error: 'Could not send email. Check SMTP settings in .env.' });
  }
  res.json({ ok: true, message: 'Code resent' });
});

// ---------- LOGIN ----------
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user) return res.status(400).json({ error: 'Invalid email or password' });
  if (!user.is_verified) return res.status(400).json({ error: 'Account not verified, please register again' });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(400).json({ error: 'Invalid email or password' });

  if (user.is_suspended) {
    return res.status(403).json({
      suspended: true,
      reason: user.suspend_reason || 'No reason provided',
      message: 'Your account has been suspended.'
    });
  }

  const deviceToken = getDeviceToken(req, res);
  const device = db.prepare('SELECT * FROM devices WHERE user_id=? AND device_token=?').get(user.id, deviceToken);

  if (device && device.verified) {
    db.prepare(`UPDATE devices SET last_login=datetime('now'), ip=? WHERE id=?`).run(req.ip, device.id);
    req.session.userId = user.id;
    return res.json({ ok: true, message: 'Logged in' });
  }

  // new / unverified device -> send OTP
  if (!device) {
    db.prepare(
      `INSERT INTO devices (user_id, device_token, ip, user_agent, verified) VALUES (?,?,?,?,0)`
    ).run(user.id, deviceToken, req.ip, req.headers['user-agent']);
  }
  try {
    await issueOtp(user, 'new_device', deviceToken);
  } catch (err) {
    console.error('Email send failed:', err.message);
    return res.status(500).json({ error: 'Could not send verification email. Check SMTP settings in .env.' });
  }
  res.json({ newDevice: true, email: user.email, message: 'New device detected. Verification code sent to your email.' });
});

router.post('/verify-login', async (req, res) => {
  const { email, code } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user) return res.status(400).json({ error: 'Account not found' });

  const otp = db.prepare(
    `SELECT * FROM otp_codes WHERE user_id=? AND type='new_device' AND code=? AND used=0 ORDER BY id DESC LIMIT 1`
  ).get(user.id, code);
  if (!otp) return res.status(400).json({ error: 'Invalid code' });
  if (new Date(otp.expires_at + 'Z').getTime() < Date.now())
    return res.status(400).json({ error: 'Code expired, please resend' });

  db.prepare('UPDATE otp_codes SET used=1 WHERE id=?').run(otp.id);
  db.prepare(`UPDATE devices SET verified=1, last_login=datetime('now') WHERE user_id=? AND device_token=?`)
    .run(user.id, otp.device_token);

  res.json({ ok: true, message: 'Device verified. Please press Login again.' });
});

// ---------- FORGOT / RESET ----------
router.post('/forgot', async (req, res) => {
  const { email } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  // Always respond ok to avoid leaking which emails exist
  if (!user) return res.json({ ok: true, message: 'If that account exists, a reset link was sent.' });

  if (!canResend(user.id, 'reset'))
    return res.status(429).json({ error: `Please wait before resending. Cooldown is ${RESEND_COOLDOWN_SEC}s.` });

  const token = genToken();
  const expires = new Date(Date.now() + RESET_TTL_MIN * 60000).toISOString();
  db.prepare(
    `INSERT INTO otp_codes (user_id, code, type, expires_at) VALUES (?,?, 'reset', ?)`
  ).run(user.id, token, expires);

  const link = `${process.env.DOMAIN}/reset-password.html?token=${token}&email=${encodeURIComponent(email)}`;
  try {
    await sendMail(user.email, 'ZyreX Password Reset', resetEmailHtml(link));
  } catch (err) {
    console.error('Email send failed:', err.message);
    return res.status(500).json({ error: 'Could not send reset email. Check SMTP settings in .env.' });
  }
  res.json({ ok: true, message: 'If that account exists, a reset link was sent.' });
});

router.post('/reset', async (req, res) => {
  const { email, token, password, confirmPassword } = req.body;
  if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user) return res.status(400).json({ error: 'Invalid link' });

  const rec = db.prepare(
    `SELECT * FROM otp_codes WHERE user_id=? AND type='reset' AND code=? AND used=0 ORDER BY id DESC LIMIT 1`
  ).get(user.id, token);
  if (!rec) return res.status(400).json({ error: 'Invalid or already-used link' });
  if (new Date(rec.expires_at + 'Z').getTime() < Date.now())
    return res.status(400).json({ error: 'Link expired, please request a new one' });

  const hash = await bcrypt.hash(password, 10);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, user.id);
  db.prepare('UPDATE otp_codes SET used=1 WHERE id=?').run(rec.id);

  const deviceToken = getDeviceToken(req, res);
  db.prepare(
    `INSERT OR IGNORE INTO devices (user_id, device_token, ip, user_agent, verified) VALUES (?,?,?,?,1)`
  ).run(user.id, deviceToken, req.ip, req.headers['user-agent']);
  db.prepare(`UPDATE devices SET verified=1 WHERE user_id=? AND device_token=?`).run(user.id, deviceToken);

  req.session.userId = user.id;
  res.json({ ok: true, message: 'Password reset, logging you in...' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  const user = db.prepare('SELECT id, name, email FROM users WHERE id=?').get(req.session.userId);
  res.json({ loggedIn: !!user, user });
});

module.exports = router;
