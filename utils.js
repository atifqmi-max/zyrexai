const nodemailer = require('nodemailer');
const crypto = require('crypto');

const SMTP_PORT = Number(process.env.SMTP_PORT || 465);

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465, // true = direct SSL (port 465), false = STARTTLS (port 587)
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: { rejectUnauthorized: false }, // many shared-hosting SMTP servers (cPanel etc) use certs that fail strict checks
  connectionTimeout: 8000,
  greetingTimeout: 8000,
  socketTimeout: 8000
});

function genOtp() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digit
}

function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function sendMail(to, subject, html) {
  await transporter.sendMail({
    from: `"ZyreX" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html
  });
}

function otpEmailHtml(code, purpose) {
  return `
  <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px">
    <h2 style="color:#111">ZyreX</h2>
    <p>Your verification code for <b>${purpose}</b> is:</p>
    <div style="font-size:32px;font-weight:bold;letter-spacing:6px;background:#f5f5f5;padding:16px;text-align:center;border-radius:8px">${code}</div>
    <p style="color:#666;font-size:13px">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
  </div>`;
}

function resetEmailHtml(link) {
  return `
  <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px">
    <h2 style="color:#111">ZyreX - Password Reset</h2>
    <p>Click the button below to reset your password. This link expires in 30 minutes.</p>
    <a href="${link}" style="display:inline-block;background:#111;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:12px">Reset Password</a>
  </div>`;
}

module.exports = { genOtp, genToken, sendMail, otpEmailHtml, resetEmailHtml };
