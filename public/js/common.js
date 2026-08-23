async function api(url, body, method = 'POST') {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch (e) {}
  return { ...data, ok: res.ok };
}
function showMsg(text, ok) {
  const el = document.getElementById('msg');
  if (!el) return;
  el.innerHTML = `<div class="msg ${ok ? 'ok' : 'error'}">${text}</div>`;
}
function startCooldown(btn, seconds = 60) {
  let s = seconds;
  btn.disabled = true;
  const original = btn.textContent;
  const timer = setInterval(() => {
    btn.textContent = `Resend in ${s}s`;
    s--;
    if (s < 0) { clearInterval(timer); btn.disabled = false; btn.textContent = original; }
  }, 1000);
}
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
