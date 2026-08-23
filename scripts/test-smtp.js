// Standalone SMTP test — run this directly on your VPS to debug email issues
// without going through the whole app.
//
// Usage:
//   cd /root/zyrexai
//   node scripts/test-smtp.js youremail@gmail.com
//
require('dotenv').config();
const nodemailer = require('nodemailer');

const toEmail = process.argv[2];
if (!toEmail) {
  console.log('Usage: node scripts/test-smtp.js your@email.com');
  process.exit(1);
}

console.log('Testing with these settings from .env:');
console.log('  EMAIL_HOST :', process.env.EMAIL_HOST);
console.log('  EMAIL_USER :', process.env.EMAIL_USER);
console.log('  SMTP_PORT  :', process.env.SMTP_PORT);
console.log('  EMAIL_PASS :', process.env.EMAIL_PASS ? '(set, ' + process.env.EMAIL_PASS.length + ' chars)' : '(MISSING)');
console.log('');

const port = Number(process.env.SMTP_PORT || 465);

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port,
  secure: port === 465,       // true for 465, false for 587/others (STARTTLS)
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: { rejectUnauthorized: false }, // many shared-hosting SMTP servers use certs that fail strict checks
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000
});

transporter.verify()
  .then(() => {
    console.log('✅ Connection + login to SMTP server succeeded.');
    return transporter.sendMail({
      from: `"ZyreX Test" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: 'ZyreX SMTP Test',
      html: '<p>If you got this, your SMTP settings are correct ✅</p>'
    });
  })
  .then(() => console.log(`✅ Test email sent to ${toEmail}. Check the inbox (and spam folder).`))
  .catch(err => {
    console.log('❌ FAILED:', err.message);
    console.log('');
    console.log('Common causes:');
    console.log('  - Invalid login / auth failed  -> wrong EMAIL_USER or EMAIL_PASS');
    console.log('  - ECONNREFUSED                 -> wrong EMAIL_HOST, or your VPS firewall blocks that port');
    console.log('  - ETIMEDOUT                    -> host unreachable or port blocked by provider/firewall');
    console.log('  - wrong version number         -> SMTP_PORT/secure mismatch (465=SSL, 587=STARTTLS)');
    console.log('  - self signed certificate       -> already handled by tls.rejectUnauthorized:false above');
    process.exit(1);
  });
