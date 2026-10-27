const PS = 10, M = { page: 1, q: '', status: '', sort: 'joinDate', total: 0 };
const initials = n => n.split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
const d10 = d => (d ? String(d).slice(0, 10) : '—');
const pillCls = { active: 'ok', expiring: 'warn', expired: 'bad', inactive: '' };
const authFail = e => e.status === 401 && (user = null, syncAuthUI(), (location.hash = '#/'), toast('Session expired — please sign in', true), true);
const ask = msg => new Promise(res => { const d = $('#confirmDlg'); $('#confirmMsg').textContent = msg; d.returnValue = ''; d.onclose = () => res(d.returnValue === 'ok'); d.showModal(); });
const CHIPS = [['', 'All'], ['active', 'Active'], ['expiring', 'Expiring soon'], ['expired', 'Expired'], ['inactive', 'Inactive']];
const drawChips = () => ($('#mChips').innerHTML = CHIPS.map(([v, l]) => `<button data-s="${v}" aria-pressed="${M.status === v}">${l}</button>`).join(''));

const row = m => { const s = m.subscriptions?.[0], dl = m.daysLeft;
  return `<tr><td><button class="lnk" data-open-member="${esc(m.id)}"><span class="av">${esc(initials(m.fullName))}</span><span>${esc(m.fullName)}<small>${esc(m.email)}</small></span></button></td><td>${esc(m.code)}</td><td>${esc(s?.planName ?? '—')}</td><td>${s ? d10(s.expiresOn) + `<small>${dl < 0 ? 'expired ' + -dl + 'd ago' : dl + 'd left'}</small>` : '—'}</td><td>${esc(m.trainer?.fullName ?? '—')}</td><td><span class="pill ${pillCls[m.status]}">${m.status}</span></td></tr>`; };

async function loadMembers() {
  drawChips(); const tb = $('#mBody'); tb.innerHTML = '<tr><td colspan="6"><div class="sk"></div></td></tr>';
  try {
    const qs = new URLSearchParams({ page: M.page, pageSize: PS, sort: M.sort, ...(M.q && { q: M.q }), ...(M.status && { status: M.status }) });
    const j = await api('/members?' + qs); M.total = j.meta.total;
    tb.innerHTML = j.data.length ? j.data.map(row).join('') : `<tr><td colspan="6" class="empty">No members match. ${M.q || M.status ? 'Try clearing the filters.' : 'Add your first member.'}</td></tr>`;
    const pages = Math.max(1, Math.ceil(M.total / PS));
    $('#mPager').innerHTML = `<span>${M.total} member${M.total === 1 ? '' : 's'} · page ${M.page}/${pages}</span><button class="btn ghost" data-pg="-1" ${M.page <= 1 ? 'disabled' : ''}>Prev</button><button class="btn ghost" data-pg="1" ${M.page >= pages ? 'disabled' : ''}>Next</button>`;
    if (!RM) gsap.from('#mBody tr', { opacity: 0, y: 10, stagger: .03, duration: .4, ease: 'power2.out' });
  } catch (e) { if (!authFail(e)) tb.innerHTML = `<tr><td colspan="6" class="empty" style="color:var(--danger)">Could not load members: ${esc(e.message)}</td></tr>`; }
}

async function openForm(m) {
  const f = $('#mForm'); f.reset(); f.dataset.id = m?.id || ''; $('#mFormErr').textContent = '';
  document.querySelectorAll('#mForm .fe').forEach(x => (x.textContent = ''));
  $('#mFormTitle').textContent = m ? 'Edit member' : 'Add member';
  let tr = []; try { tr = (await api('/trainers?status=active')).data; } catch (e) { if (authFail(e)) return; }
  f.elements.trainerId.innerHTML = '<option value="">Unassigned</option>' + tr.map(t => `<option value="${esc(t.id)}">${esc(t.fullName)}</option>`).join('');
  if (m) { for (const k of ['fullName', 'email', 'phone', 'gender', 'emergencyContact', 'notes']) f.elements[k].value = m[k] ?? '';
    f.elements.dob.value = m.dob ? d10(m.dob) : ''; f.elements.trainerId.value = m.trainerId ?? ''; f.elements.isActive.checked = m.isActive; }
  $('#detailDlg').close(); $('#memberDlg').showModal();
}
async function saveForm(e) {
  e.preventDefault(); const f = e.target, v = Object.fromEntries(new FormData(f)), errs = {};
  if (v.fullName.trim().length < 2) errs.fullName = 'Enter the full name';
  if (!/^\S+@\S+\.\S+$/.test(v.email.trim())) errs.email = 'Enter a valid email address';
  if (!/^\+?\d{10,13}$/.test(v.phone.trim())) errs.phone = '10–13 digits, optional leading +';
  const show = x => document.querySelectorAll('#mForm .fe').forEach(s => (s.textContent = x[s.dataset.err] || ''));
  show(errs); $('#mFormErr').textContent = ''; if (Object.keys(errs).length) return f.querySelector('.fe:not(:empty)')?.previousElementSibling.focus();
  const id = f.dataset.id, body = { fullName: v.fullName.trim(), email: v.email.trim(), phone: v.phone.trim(), isActive: f.elements.isActive.checked };
  for (const k of ['dob', 'gender', 'emergencyContact', 'notes']) if (v[k]) body[k] = v[k];
  if (id) body.trainerId = v.trainerId || null; else if (v.trainerId) body.trainerId = v.trainerId;
  const btn = $('#mSave'); btn.disabled = true; btn.textContent = 'Saving…';
  try { const j = await api(id ? '/members/' + id : '/members', { method: id ? 'PATCH' : 'POST', body });
    $('#memberDlg').close(); toast(id ? 'Member updated ✓' : `Member ${j.data.code} added ✓`); loadMembers(); if (!$('#dashboard').hidden) loadDashboard();
  } catch (err) { if (authFail(err)) return;
    if (err.details) show(Object.fromEntries(err.details.map(d => [d.path[0], d.message]))); 
    $('#mFormErr').textContent = err.status === 409 ? 'A member with this email or phone already exists.' : err.message; }
  btn.disabled = false; btn.textContent = 'Save';
}

async function openMember(id) {
  const dlg = $('#detailDlg'), box = $('#detailBody'); box.innerHTML = '<div class="sk"></div>'; if (!dlg.open) dlg.showModal();
  try {
    const [{ data: m }, { data: plans }] = await Promise.all([api('/members/' + id), api('/plans')]);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const cur = m.subscriptions.filter(s => s.status === 'ACTIVE').sort((a, b) => (a.expiresOn < b.expiresOn ? 1 : -1))[0];
    const dl = cur ? Math.round((Date.parse(d10(cur.expiresOn)) - Date.parse(today)) / 864e5) : null;
    const st = !m.isActive ? 'inactive' : dl === null || dl < 0 ? 'expired' : dl <= 7 ? 'expiring' : 'active';
    const early = new Set(m.renewals.filter(r => r.wasEarly).map(r => r.subscriptionId));
    box.innerHTML = `<div class="dh"><span class="av lg">${esc(initials(m.fullName))}</span><div><h2>${esc(m.fullName)}</h2><small>${esc(m.code)} · <span class="pill ${pillCls[st]}">${st}</span></small></div></div>
    <div class="row" style="justify-content:flex-start;margin-bottom:16px"><button class="btn ghost" id="dEdit">Edit</button>${user?.role === 'ADMIN' ? '<button class="btn ghost" id="dDel">Delete</button>' : ''}</div>
    <dl class="kv"><dt>Email</dt><dd>${esc(m.email)}</dd><dt>Phone</dt><dd>${esc(m.phone)}</dd><dt>Joined</dt><dd>${d10(m.joinDate)}</dd><dt>Trainer</dt><dd>${esc(m.trainer?.fullName ?? 'Unassigned')}</dd><dt>Birth date</dt><dd>${d10(m.dob)}</dd><dt>Emergency</dt><dd>${esc(m.emergencyContact ?? '—')}</dd><dt>Notes</dt><dd>${esc(m.notes ?? '—')}</dd></dl>
    <h3>Membership</h3><p>${cur ? `${esc(cur.planName)} until <b>${d10(cur.expiresOn)}</b> (${dl < 0 ? 'expired ' + -dl + ' days ago' : dl + ' days left'})` : 'No active membership.'}</p>
    <div class="rn"><select id="rnPlan" aria-label="Plan">${plans.filter(p => p.isActive).map(p => `<option value="${esc(p.id)}">${esc(p.name)} — ${fmt(p.price)} · ${p.durationDays}d</option>`).join('')}</select>
    <select id="rnMethod" aria-label="Payment method">${['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'].map(x => `<option value="${x}">${x.replace('_', ' ').toLowerCase()}</option>`).join('')}</select>
    <button class="btn primary" id="rnGo">${cur ? 'Renew membership' : 'Start membership'}</button><p id="rnMsg" role="status">Records a manual payment. If the plan is still running, the new period starts the day after it ends.</p></div>
    <h3>Membership history</h3><ul class="list">${m.subscriptions.map(s => `<li><span>${esc(s.planName)}${early.has(s.id) ? ' <small>(early renewal)</small>' : ''}${s.status === 'CANCELLED' ? ' <small>(cancelled)</small>' : ''}<br><small style="color:var(--muted)">${d10(s.startsOn)} → ${d10(s.expiresOn)}</small></span><span>${fmt(s.priceSnapshot)}</span></li>`).join('') || '<li class="empty">None yet.</li>'}</ul>
    <h3>Payments</h3><ul class="list">${m.payments.map(p => `<li><span>${esc(p.receiptNo)}<br><small style="color:var(--muted)">${d10(p.paidOn)} · ${p.method.toLowerCase()}</small></span><span>${fmt(p.amount)} <span class="pill ${{ PAID: 'ok', FAILED: 'bad' }[p.status] || 'warn'}">${p.status.toLowerCase()}</span></span></li>`).join('') || '<li class="empty">No payments yet.</li>'}</ul>`;
    let key = crypto.randomUUID(); const fresh = () => (key = crypto.randomUUID());
    $('#rnPlan').onchange = $('#rnMethod').onchange = fresh;
    $('#dEdit').onclick = () => openForm(m);
    if ($('#dDel')) $('#dDel').onclick = async () => {
      if (!(await ask(`Delete ${m.fullName}? This can't be undone.`))) return;
      try { await api('/members/' + id, { method: 'DELETE' }); $('#detailDlg').close(); toast('Member deleted'); loadMembers(); }
      catch (e) { toast(e.status === 409 ? 'Members with payment or membership history can’t be deleted. Mark them inactive instead.' : e.message, true); } };
    $('#rnGo').onclick = async ev => {
      const b = ev.currentTarget; b.disabled = true; $('#rnMsg').textContent = 'Recording renewal…';
      try { const j = await api('/renewals', { method: 'POST', body: { memberId: id, planId: $('#rnPlan').value, method: $('#rnMethod').value, idempotencyKey: key } });
        fresh(); toast(j.duplicate ? 'Already renewed — no duplicate created' : 'Membership renewed ✓'); loadMembers(); openMember(id);
      } catch (e) { if (!authFail(e)) { $('#rnMsg').textContent = 'Renewal failed: ' + e.message; b.disabled = false; } } };
    if (!RM) gsap.from('#detailBody>*', { opacity: 0, y: 12, stagger: .04, duration: .4, ease: 'power2.out' });
  } catch (e) { if (!authFail(e)) box.innerHTML = `<p class="empty" style="color:var(--danger)">Could not load member: ${esc(e.message)}</p>`; }
}

/* notifications (in-app only) */
async function refreshBell() {
  try { const j = await api('/notifications'); $('#bellDot').hidden = !j.meta.unread;
    $('#bellMenu').innerHTML = (j.data.length ? `<button class="n" data-readall>Mark all as read</button>` + j.data.map(n => `<button class="n ${n.readAt ? '' : 'u'}" data-nid="${esc(n.id)}">${esc(n.message)}</button>`).join('') : '<p class="empty" style="padding:10px">No notifications.</p>');
  } catch {}
}
function afterAuth() { $('#bellWrap').hidden = !user; if (user) refreshBell(); }
const bell = () => { const m = $('#bellMenu'), o = m.hidden; m.hidden = !o; $('#bellBtn').setAttribute('aria-expanded', o);
  if (o && !RM) gsap.from('#bellMenu .n', { opacity: 0, y: 8, stagger: .04, duration: .3 }); };

/* wiring */
let tmr;
$('#mQ').oninput = e => { clearTimeout(tmr); tmr = setTimeout(() => { M.q = e.target.value.trim(); M.page = 1; loadMembers(); }, 300); };
$('#mSort').onchange = e => { M.sort = e.target.value; M.page = 1; loadMembers(); };
$('#mChips').onclick = e => { const s = e.target.dataset.s; if (s !== undefined) { M.status = s; M.page = 1; loadMembers(); } };
$('#mPager').onclick = e => { const d = +e.target.dataset.pg; if (d) { M.page += d; loadMembers(); } };
$('#mForm').onsubmit = saveForm;
$('#mImport').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try { const r = await fetch('/api/transfer/members', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'text/csv', 'X-Requested-With': 'ironflow' }, body: await file.text() });
    const j = await r.json(), d = j.data;
    if (!d) return toast(j.error?.message || 'Import failed', true);
    toast(`Imported ${d.imported}${d.errors.length ? `, ${d.errors.length} skipped (row ${d.errors[0].row}: ${d.errors[0].error})` : ''}`, !d.imported); loadMembers();
  } catch { toast('Import failed', true); } };
document.addEventListener('click', e => {
  const o = e.target.closest('[data-open-member]'); if (o) return openMember(o.dataset.openMember);
  const a = e.target.closest('[data-act]')?.dataset.act;
  if (a === 'add') openForm(); else if (a === 'members' || a === 'expiring') { M.status = a === 'expiring' ? 'expiring' : ''; M.page = 1; location.hash = '#/members'; if (location.hash === '#/members') loadMembers(); }
  if (e.target.closest('#bellBtn')) return bell();
  const n = e.target.closest('[data-nid],[data-readall]');
  if (n) api(n.dataset.nid ? `/notifications/${n.dataset.nid}/read` : '/notifications/read-all', { method: 'POST' }).then(refreshBell);
  else if (!e.target.closest('#bellMenu')) $('#bellMenu').hidden = true;
});
addEventListener('keydown', e => e.key === 'Escape' && ($('#bellMenu').hidden = true));
