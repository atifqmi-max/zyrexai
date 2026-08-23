let currentChatId = null;
let uploadedFile = null;

async function init() {
  const me = await api('/api/auth/me', null, 'GET');
  if (!me.loggedIn) return location.href = '/index.html';
  loadChats();
}

async function loadChats(selectId) {
  const r = await api('/api/chats', null, 'GET');
  const list = document.getElementById('chatList');
  list.innerHTML = '';
  (r.chats || []).forEach(c => {
    const div = document.createElement('div');
    div.className = 'chat-item' + (c.id === currentChatId ? ' active' : '');
    div.innerHTML = `<span class="title">${escapeHtml(c.title)}</span>
      <span class="actions">
        <span title="Rename" data-act="rename">✏️</span>
        <span title="Delete" data-act="delete">🗑️</span>
      </span>`;
    div.querySelector('.title').onclick = () => openChat(c.id, c.title);
    div.querySelector('[data-act="rename"]').onclick = async (e) => {
      e.stopPropagation();
      const t = prompt('Rename chat', c.title);
      if (t) { await api(`/api/chats/${c.id}`, { title: t }, 'PATCH'); loadChats(currentChatId); }
    };
    div.querySelector('[data-act="delete"]').onclick = async (e) => {
      e.stopPropagation();
      if (confirm('Delete this chat?')) {
        await api(`/api/chats/${c.id}`, null, 'DELETE');
        if (currentChatId === c.id) { currentChatId = null; document.getElementById('messages').innerHTML=''; document.getElementById('chatTitle').textContent='Select or start a chat'; }
        loadChats();
      }
    };
    list.appendChild(div);
  });
  if (selectId) openChat(selectId);
}

async function openChat(id, title) {
  currentChatId = id;
  document.getElementById('chatTitle').textContent = title || 'Chat';
  loadChats(); // refresh active highlight
  const r = await api(`/api/chats/${id}/messages`, null, 'GET');
  const box = document.getElementById('messages');
  box.innerHTML = '';
  (r.messages || []).forEach(m => renderMessage(m.role, m.content));
  box.scrollTop = box.scrollHeight;
}

function renderMessage(role, content) {
  const box = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'message ' + role;
  div.innerHTML = formatContent(content);
  box.appendChild(div);
  div.querySelectorAll('pre').forEach(pre => {
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.onclick = () => {
      navigator.clipboard.writeText(pre.querySelector('code').textContent);
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 1500);
    };
    pre.appendChild(btn);
  });
  box.scrollTop = box.scrollHeight;
  return div;
}

function formatContent(text) {
  // Convert ```lang code``` blocks into <pre><code>, escape everything else, then handle download requests separately
  const parts = text.split(/```(\w*)\n?([\s\S]*?)```/g);
  let html = '';
  for (let i = 0; i < parts.length; i += 3) {
    html += escapeHtml(parts[i] || '').replace(/\n/g, '<br>');
    if (parts[i + 1] !== undefined) {
      html += `<pre><code>${escapeHtml(parts[i + 2] || '')}</code></pre>`;
    }
  }
  return html;
}

document.getElementById('newChatBtn').onclick = async () => {
  const r = await api('/api/chats', null, 'POST');
  loadChats(r.id);
};

document.getElementById('sendBtn').onclick = sendMessage;
document.getElementById('input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

async function sendMessage() {
  const input = document.getElementById('input');
  let content = input.value.trim();
  if (!content) return;
  if (!currentChatId) {
    const r = await api('/api/chats', null, 'POST');
    currentChatId = r.id;
    loadChats(currentChatId);
  }
  if (uploadedFile) {
    content += `\n\n[Attached file: ${uploadedFile.name}](${uploadedFile.path})`;
    uploadedFile = null;
  }
  input.value = '';
  renderMessage('user', content);

  const thinking = renderMessage('assistant', 'Thinking...');
  const webSearch = document.getElementById('webSearchToggle').checked;
  const r = await api(`/api/chats/${currentChatId}/messages`, { content, webSearch }, 'POST');
  thinking.remove();
  if (r.error) { renderMessage('assistant', 'Error: ' + r.error); return; }
  renderMessage('assistant', r.reply);
  loadChats(currentChatId);

  // Detect "save as file" style requests already answered by AI text is just shown;
  // Users can also explicitly request a downloadable file via the button below each AI code/long text reply.
  maybeOfferDownload(r.reply);
}

function maybeOfferDownload(reply) {
  if (/```/.test(reply) || reply.length > 400) {
    const box = document.getElementById('messages');
    const last = box.lastElementChild;
    const dl = document.createElement('button');
    dl.className = 'mini-btn';
    dl.style.marginTop = '8px';
    dl.textContent = '⬇ Download as file';
    dl.onclick = async () => {
      const r = await api('/api/generate-file', { content: reply, filename: 'zyrex-output.txt' }, 'POST');
      if (r.ok) window.open(r.url, '_blank');
    };
    last.appendChild(document.createElement('br'));
    last.appendChild(dl);
  }
}

document.getElementById('attachBtn').onclick = () => document.getElementById('fileInput').click();
document.getElementById('fileInput').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  const data = await res.json();
  if (data.ok) { uploadedFile = data; alert('File attached: ' + data.name); }
};

document.getElementById('logoutBtn').onclick = async () => {
  await api('/api/auth/logout');
  location.href = '/index.html';
};

// Support modal
document.getElementById('supportBtn').onclick = () => document.getElementById('supportOverlay').style.display = 'flex';
document.getElementById('closeSupportBtn').onclick = () => document.getElementById('supportOverlay').style.display = 'none';
document.getElementById('submitSupportBtn').onclick = async () => {
  const category = document.getElementById('supportCategory').value;
  const message = document.getElementById('supportMessage').value.trim();
  if (!message) return;
  const r = await api('/api/support/tickets', { category, message }, 'POST');
  document.getElementById('supportMsg').innerHTML = `<div class="msg ${r.ok?'ok':'error'}">${r.ok ? 'Submitted! Our team will get back to you.' : r.error}</div>`;
  if (r.ok) document.getElementById('supportMessage').value = '';
};

init();
