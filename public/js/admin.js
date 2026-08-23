document.getElementById('loginBtn').onclick = async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const r = await api('/api/admin/login', { email, password });
  if (!r.ok) return showMsg(r.error, false);
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminShell').style.display = 'flex';
  loadDashboard(); loadUsers(); loadTickets();
};

document.getElementById('adminLogout').onclick = async () => {
  await api('/api/admin/logout');
  location.reload();
};

document.querySelectorAll('.nav-item[data-tab]').forEach(el => {
  el.onclick = () => {
    document.querySelectorAll('.nav-item[data-tab]').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    ['dashboard','users','support'].forEach(t => document.getElementById('tab-'+t).style.display = (t === el.dataset.tab ? 'block' : 'none'));
  };
});

async function loadDashboard() {
  const r = await api('/api/admin/stats', null, 'GET');
  document.getElementById('statGrid').innerHTML = `
    <div class="stat-card"><div class="num">${r.totalUsers||0}</div><div class="label">Total Users</div></div>
    <div class="stat-card"><div class="num">${r.totalChats||0}</div><div class="label">Total Chats</div></div>
    <div class="stat-card"><div class="num">${r.totalVisitors||0}</div><div class="label">Total Visitors</div></div>
    <div class="stat-card"><div class="num">${r.openTickets||0}</div><div class="label">Open Support Tickets</div></div>`;
}

async function loadUsers(search) {
  const r = await api('/api/admin/users' + (search ? `?search=${encodeURIComponent(search)}` : ''), null, 'GET');
  const tbody = document.getElementById('userTable');
  tbody.innerHTML = '';
  (r.users || []).forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.id}</td><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.email)}</td>
      <td><span class="badge ${u.is_suspended?'suspended':'active'}">${u.is_suspended?'Suspended':'Active'}</span></td>
      <td>${u.created_at}</td>
      <td>
        <button class="mini-btn" data-act="chats">Chats</button>
        ${u.is_suspended
          ? `<button class="mini-btn" data-act="unsuspend">Unsuspend</button>`
          : `<button class="mini-btn danger" data-act="suspend">Suspend</button>`}
        <button class="mini-btn danger" data-act="delete">Delete</button>
      </td>`;
    tr.querySelector('[data-act="chats"]').onclick = () => showUserChats(u.id, u.name);
    tr.querySelector('[data-act="delete"]').onclick = async () => {
      if (confirm(`Delete user ${u.email}? This cannot be undone.`)) {
        await api(`/api/admin/users/${u.id}`, null, 'DELETE'); loadUsers(); loadDashboard();
      }
    };
    if (u.is_suspended) {
      tr.querySelector('[data-act="unsuspend"]').onclick = async () => { await api(`/api/admin/users/${u.id}/unsuspend`, {}, 'POST'); loadUsers(); };
    } else {
      tr.querySelector('[data-act="suspend"]').onclick = async () => {
        const reason = prompt('Reason for suspension:');
        if (reason === null) return;
        await api(`/api/admin/users/${u.id}/suspend`, { reason }, 'POST'); loadUsers();
      };
    }
    tbody.appendChild(tr);
  });
}

document.getElementById('userSearch').addEventListener('input', e => loadUsers(e.target.value));

async function showUserChats(userId, name) {
  const r = await api(`/api/admin/users/${userId}/chats`, null, 'GET');
  document.getElementById('chatsModalTitle').textContent = `${name}'s Chats`;
  const list = document.getElementById('chatsList');
  list.innerHTML = '';
  (r.chats || []).forEach(c => {
    const row = document.createElement('div');
    row.style = 'display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid var(--border)';
    row.innerHTML = `<span>${escapeHtml(c.title)} ${c.is_suspended ? '<span class="badge suspended">Suspended</span>' : ''}</span>
      <span>
        <button class="mini-btn" data-act="view">View</button>
        ${c.is_suspended
          ? `<button class="mini-btn" data-act="unsuspend">Unsuspend</button>`
          : `<button class="mini-btn danger" data-act="suspend">Suspend</button>`}
        <button class="mini-btn danger" data-act="delete">Delete</button>
      </span>`;
    row.querySelector('[data-act="view"]').onclick = () => showChatMessages(c.id);
    row.querySelector('[data-act="delete"]').onclick = async () => {
      if (confirm('Delete this chat?')) { await api(`/api/admin/chats/${c.id}`, null, 'DELETE'); showUserChats(userId, name); loadDashboard(); }
    };
    if (c.is_suspended) row.querySelector('[data-act="unsuspend"]').onclick = async () => { await api(`/api/admin/chats/${c.id}/unsuspend`, {}, 'POST'); showUserChats(userId, name); };
    else row.querySelector('[data-act="suspend"]').onclick = async () => { await api(`/api/admin/chats/${c.id}/suspend`, {}, 'POST'); showUserChats(userId, name); };
    list.appendChild(row);
  });
  document.getElementById('chatsOverlay').style.display = 'flex';
}
document.getElementById('closeChatsModal').onclick = () => document.getElementById('chatsOverlay').style.display = 'none';

async function showChatMessages(chatId) {
  const r = await api(`/api/admin/chats/${chatId}/messages`, null, 'GET');
  const list = document.getElementById('msgsList');
  list.innerHTML = '';
  (r.messages || []).forEach(m => {
    const div = document.createElement('div');
    div.style = 'margin-bottom:10px';
    div.innerHTML = `<b>${m.role}:</b> ${escapeHtml(m.content).replace(/\n/g,'<br>')}`;
    list.appendChild(div);
  });
  document.getElementById('msgsOverlay').style.display = 'flex';
}
document.getElementById('closeMsgsModal').onclick = () => document.getElementById('msgsOverlay').style.display = 'none';

async function loadTickets() {
  const r = await api('/api/admin/support/tickets', null, 'GET');
  const tbody = document.getElementById('ticketTable');
  tbody.innerHTML = '';
  (r.tickets || []).forEach(t => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${t.id}</td><td>${escapeHtml(t.user_name)}<br><small>${escapeHtml(t.user_email)}</small></td>
      <td>${escapeHtml(t.category)}</td><td>${escapeHtml(t.message)}</td>
      <td><span class="badge ${t.status==='open'?'active':'suspended'}">${t.status}</span></td>
      <td><button class="mini-btn" data-act="toggle">${t.status==='open' ? 'Mark Closed' : 'Reopen'}</button></td>`;
    tr.querySelector('[data-act="toggle"]').onclick = async () => {
      await api(`/api/admin/support/tickets/${t.id}/status`, { status: t.status==='open'?'closed':'open' }, 'POST');
      loadTickets(); loadDashboard();
    };
    tbody.appendChild(tr);
  });
}
