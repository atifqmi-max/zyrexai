let pendingEmail = null;

// If already logged in (valid session), skip straight to chat.
(async () => {
  const me = await api('/api/auth/me', null, 'GET');
  if (me.loggedIn) { location.href = '/chat.html'; return; }
})();

document.getElementById('regBtn').onclick = async () => {
  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  if (!name || !email || !password || !confirmPassword) return showMsg('Please fill in all fields', false);

  const r = await api('/api/auth/register', { name, email, password, confirmPassword });
  if (!r.ok) return showMsg(r.error, false);

  pendingEmail = r.email;
  showMsg(r.message, true);
  document.getElementById('regForm').style.display = 'none';
  document.getElementById('otpForm').style.display = 'block';
};

document.getElementById('verifyBtn').onclick = async () => {
  const code = document.getElementById('otpCode').value.trim();
  const r = await api('/api/auth/verify-register', { email: pendingEmail, code });
  if (!r.ok) return showMsg(r.error, false);
  showMsg('Verified! Redirecting...', true);
  setTimeout(() => location.href = '/chat.html', 700);
};

document.getElementById('resendBtn').onclick = async () => {
  const r = await api('/api/auth/resend-otp', { email: pendingEmail, type: 'register' });
  showMsg(r.ok ? 'Code resent' : r.error, r.ok);
  if (r.ok) startCooldown(document.getElementById('resendBtn'));
};
