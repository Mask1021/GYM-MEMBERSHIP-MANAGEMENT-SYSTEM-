/* ---------- partial refunds ---------- */
let rfKey = '', rfLeft = 0;
async function openRefund(id) {
  try {
    const p = (await api('/payments/' + id)).data; if (!(p.remaining > 0)) return toast('Already fully refunded', true);
    rfKey = crypto.randomUUID(); rfLeft = p.remaining; const f = $('#rfForm'); f.reset(); fieldErr('#rfForm', {}); f.querySelector('.form-err').textContent = '';
    $('#rfInfo').textContent = `${p.receiptNo}: paid ${fmt(p.amount)}, already refunded ${fmt(p.refunded)}, refundable ${fmt(p.remaining)}. A refund adds a new ledger entry; the original payment stays.`;
    f.elements.amount.value = p.remaining; f.dataset.id = id; $('#refundDlg').showModal();
  } catch (e) { if (!authFail(e)) toast(e.message, true); }
}
wireForm('#rfForm', v => (!(+v.amount > 0) || +v.amount > rfLeft + 1e-9 ? { amount: `Enter an amount between 0.01 and ${rfLeft}` } : {}),
  async (v, id) => { await api(`/payments/${id}/refund`, { method: 'POST', body: { amount: +v.amount, idempotencyKey: rfKey } }); toast('Refund recorded ✓'); loadPayments(); });

/* ---------- audit log ---------- */
const AU = { page: 1, entity: '' };
const ALBL = { RENEW: 'Renewed membership', REFUND: 'Refunded payment', RECORD_PAYMENT: 'Recorded payment', PAYMENT_STATUS: 'Changed payment status', CREATE: 'Created', REASSIGN: 'Reassigned members', CANCEL_SUBSCRIPTION: 'Cancelled subscription', PASSWORD_CHANGE: 'Changed password', USER_CREATE: 'Created account', USER_UPDATE: 'Updated account', USER_DELETE: 'Removed account' };
const metaTxt = m => (m ? Object.entries(m).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : '');
const istTime = t => new Date(String(t).replace(' ', 'T') + (/[zZ+]/.test(t) ? '' : 'Z')).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
async function loadAudit() {
  const tb = $('#auBody'); tb.innerHTML = '<tr><td colspan="5"><div class="sk"></div></td></tr>';
  try {
    const j = await api(`/audit?page=${AU.page}` + (AU.entity ? '&entity=' + AU.entity : ''));
    tb.innerHTML = j.data.length ? j.data.map(a => `<tr><td>${esc(istTime(a.createdAt))}</td><td>${esc(a.userName ?? '—')}</td><td>${esc(ALBL[a.action] || a.action)}</td><td>${esc(a.entity)} <small>${esc(String(a.entityId).slice(0, 8))}</small></td><td><small>${esc(metaTxt(a.meta))}</small></td></tr>`).join('') : '<tr><td colspan="5" class="empty">No entries yet.</td></tr>';
    const pages = Math.max(1, Math.ceil(j.meta.total / 15));
    $('#auPager').innerHTML = `<span>${j.meta.total} entries · page ${AU.page}/${pages}</span><button class="btn ghost" data-apg="-1" ${AU.page <= 1 ? 'disabled' : ''}>Prev</button><button class="btn ghost" data-apg="1" ${AU.page >= pages ? 'disabled' : ''}>Next</button>`;
  } catch (e) { if (!authFail(e)) tb.innerHTML = `<tr><td colspan="5" class="empty" style="color:var(--danger)">${e.status === 403 ? 'Only admins can view the audit log.' : 'Could not load: ' + esc(e.message)}</td></tr>`; }
}
$('#auEntity').onchange = e => { AU.entity = e.target.value; AU.page = 1; loadAudit(); };

/* ---------- staff accounts ---------- */
let USERS = [];
async function loadUsers() {
  try { USERS = (await api('/users')).data;
    $('#userList').innerHTML = USERS.map(u => `<li><span>${esc(u.name)}<br><small style="color:var(--muted)">${esc(u.email)}</small></span><span><span class="pill ${u.role === 'ADMIN' ? 'ok' : ''}">${u.role.toLowerCase()}</span> <button class="btn ghost sm" data-uedit="${esc(u.id)}">Edit</button>${u.id !== user.id ? ` <button class="btn ghost sm" data-udel="${esc(u.id)}">Remove</button>` : ''}</span></li>`).join('');
  } catch (e) { if (!authFail(e)) $('#userList').innerHTML = `<li class="empty" style="color:var(--danger)">${esc(e.message)}</li>`; }
}
function openUser(u) {
  const f = $('#usForm'); f.reset(); f.dataset.id = u?.id || ''; fieldErr('#usForm', {}); f.querySelector('.form-err').textContent = ''; $('#usTitle').textContent = u ? 'Edit account' : 'Add staff account';
  f.elements.email.disabled = !!u; f.elements.name.value = u?.name ?? ''; f.elements.email.value = u?.email ?? ''; f.elements.role.value = u?.role ?? 'STAFF';
  $('#usPw').firstChild.textContent = u ? 'New password (leave blank to keep)' : 'Password (10+ characters)'; $('#userDlg').showModal();
}
wireForm('#usForm', v => { const e = {}, edit = !!$('#usForm').dataset.id;
  if ((v.name || '').trim().length < 2) e.name = 'Enter the full name'; if (!edit && !/^\S+@\S+\.\S+$/.test(v.email || '')) e.email = 'Enter a valid email';
  if ((!edit || v.password) && (v.password || '').length < 10) e.password = 'Use at least 10 characters'; return e; },
  async (v, id) => { if (id) await api('/users/' + id, { method: 'PATCH', body: { name: v.name.trim(), role: v.role, ...(v.password && { password: v.password }) } });
    else await api('/users', { method: 'POST', body: { name: v.name.trim(), email: v.email.trim(), role: v.role, password: v.password } });
    toast(id ? 'Account updated ✓' : 'Account created ✓'); loadUsers(); });
const _ls = loadSettings; window.loadSettings = async () => { await _ls(); $('#staffPanel').hidden = !isAdmin(); if (isAdmin()) loadUsers(); };
$('#addUser').onclick = () => openUser();
document.addEventListener('click', async e => {
  const g = k => e.target.closest(`[data-${k}]`)?.dataset[k]; let v;
  if ((v = g('uedit'))) openUser(USERS.find(u => u.id === v));
  else if ((v = g('udel'))) { const u = USERS.find(x => x.id === v); if (!(await ask(`Remove ${u.name}'s account?`))) return;
    try { await api('/users/' + v, { method: 'DELETE' }); toast('Account removed'); loadUsers(); } catch (er) { toast(er.message, true); } }
  else if ((v = g('apg'))) { AU.page += +v; loadAudit(); }
});
