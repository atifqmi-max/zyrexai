let pendingEmail = null;

// If already logged in (valid session), skip the login form entirely.
(async () => {
  const me = await api('/api/auth/me', null, 'GET');
  if (me.loggedIn) { location.href = '/chat.html'; return; }
})();

document.getElementById('loginBtn').onclick = async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || !password) return showMsg('Please fill in all fields', false);

  const r = await api('/api/auth/login', { email, password });

  if (r.suspended) {
    document.getElementById('loginForm').innerHTML = `
      <div class="msg error">
        Your account has been suspended.<br><br>
        <b>Reason:</b> ${escapeHtml(r.reason)}
      </div>
      <a href="/index.html#support" class="btn secondary" style="display:block;text-align:center;text-decoration:none;box-sizing:border-box" onclick="alert('Please contact support at ${document.title.includes('ZyreX')?'the email on file':''}'); return false;">Contact Support Team</a>`;
    return;
  }
  if (!r.ok) return showMsg(r.error, false);

  if (r.newDevice) {
    pendingEmail = r.email;
    showMsg(r.message, true);
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('otpForm').style.display = 'block';
    return;
  }
  showMsg('Logged in! Redirecting...', true);
  setTimeout(() => location.href = '/chat.html', 600);
};

document.getElementById('verifyBtn').onclick = async () => {
  const code = document.getElementById('otpCode').value.trim();
  const r = await api('/api/auth/verify-login', { email: pendingEmail, code });
  if (!r.ok) return showMsg(r.error, false);
  showMsg('Device verified! Please press Login again.', true);
  document.getElementById('otpForm').style.display = 'none';
  document.getElementById('loginForm').style.display = 'block';
};

document.getElementById('resendBtn').onclick = async () => {
  const r = await api('/api/auth/resend-otp', { email: pendingEmail, type: 'new_device' });
  showMsg(r.ok ? 'Code resent' : r.error, r.ok);
  if (r.ok) startCooldown(document.getElementById('resendBtn'));
};
