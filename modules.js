const isAdmin = () => user?.role === 'ADMIN';
const fieldErr = (id, e) => document.querySelectorAll(`${id} .fe`).forEach(s => (s.textContent = e[s.dataset.err] || ''));
const serverErrs = e => (e.details ? Object.fromEntries(e.details.map(d => [d.path[0], d.message])) : {});
function wireForm(id, validate, send) {
  const f = $(id);
  f.onsubmit = async e => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(f)); v.isActive = f.elements.isActive?.checked;
    const errs = validate(v), fe = f.querySelector('.form-err'); fieldErr(id, errs); fe.textContent = '';
    if (Object.keys(errs).length) return f.querySelector('.fe:not(:empty)')?.previousElementSibling?.focus();
    const b = f.querySelector('.btn.primary'), t = b.textContent; b.disabled = true; b.textContent = 'Saving…';
    try { await send(v, f.dataset.id); f.closest('dialog').close(); }
    catch (er) { if (!authFail(er)) { fieldErr(id, serverErrs(er)); fe.textContent = er.status === 409 ? 'That value already exists, or the record changed.' : er.message; } }
    b.disabled = false; b.textContent = t;
  };
}
const openDlg = (id, title, tid, f, rec, keys) => { const fm = $(f); fm.reset(); fm.dataset.id = rec?.id || ''; $(tid).textContent = title; fm.querySelector('.form-err').textContent = ''; fieldErr(f, {});
  if (rec) { keys.forEach(k => (fm.elements[k].value = rec[k] ?? '')); fm.elements.isActive.checked = rec.isActive; } $(id).showModal(); };

/* ---------- Plans ---------- */
let PLANS = [];
async function loadPlans() {
  const g = $('#planGrid'); $('#addPlan').hidden = !isAdmin(); g.innerHTML = '<div class="sk"></div>'.repeat(3);
  try {
    PLANS = (await api('/plans')).data;
    g.innerHTML = PLANS.map(p => `<article class="card ${p.isActive ? '' : 'dim'}"><small>${p.isActive ? '' : 'Archived · '}${p.durationDays} days</small><h3>${esc(p.name)}</h3><b class="price">${fmt(p.price)}</b><small>${fmt(p.price / p.durationDays)} / day</small><ul class="ben">${p.benefits.map(b => `<li>${esc(b)}</li>`).join('')}</ul><p class="d">${p.activeSubs} active · ${fmt(p.revenue)} net revenue</p>${isAdmin() ? `<div class="row"><button class="btn ghost sm" data-pedit="${esc(p.id)}">Edit</button><button class="btn ghost sm" data-ptoggle="${esc(p.id)}">${p.isActive ? 'Archive' : 'Restore'}</button></div>` : ''}</article>`).join('') || '<p class="empty" style="padding:0 clamp(16px,4vw,48px)">No plans yet.</p>';
    const act = PLANS.filter(p => p.isActive), ben = [...new Set(act.flatMap(p => p.benefits))];
    $('#planCmp').innerHTML = act.length ? `<thead><tr><th></th>${act.map(p => `<th>${esc(p.name)}</th>`).join('')}</tr></thead><tbody>${[['Duration', p => p.durationDays + ' days'], ['Price', p => fmt(p.price)], ['Per day', p => fmt(p.price / p.durationDays)], ['Active subscriptions', p => p.activeSubs], ['Net revenue', p => fmt(p.revenue)]].map(([l, f]) => `<tr><td>${l}</td>${act.map(p => `<td>${f(p)}</td>`).join('')}</tr>`).join('')}${ben.map(b => `<tr><td>${esc(b)}</td>${act.map(p => `<td>${p.benefits.includes(b) ? '<span class="ok-c">✓</span>' : '–'}</td>`).join('')}</tr>`).join('')}</tbody>` : '<tbody><tr><td class="empty">No active plans to compare.</td></tr></tbody>';
    if (!RM) gsap.from('#planGrid .card', { y: 24, opacity: 0, stagger: .07, duration: .6, ease: 'power3.out' });
  } catch (e) { if (!authFail(e)) g.innerHTML = `<p class="empty" style="color:var(--danger)">Could not load plans: ${esc(e.message)}</p>`; }
}
wireForm('#plForm', v => { const e = {};
  if (v.name.trim().length < 2) e.name = 'Enter a plan name';
  if (!(Number.isInteger(+v.durationDays) && +v.durationDays > 0)) e.durationDays = 'Whole number of days, at least 1';
  if (v.price === '' || +v.price < 0) e.price = 'Enter a price (0 or more)'; return e; },
  async (v, id) => { const body = { name: v.name.trim(), durationDays: +v.durationDays, price: +v.price, description: v.description || undefined, benefits: v.benefits.split('\n').map(x => x.trim()).filter(Boolean), isActive: v.isActive };
    await api(id ? '/plans/' + id : '/plans', { method: id ? 'PATCH' : 'POST', body }); toast(id ? 'Plan updated ✓' : 'Plan created ✓'); loadPlans(); });

/* ---------- Trainers ---------- */
let TR = [];
const drawTrainers = () => {
  const sp = $('#tSpec').value, st = $('#tStat').value, max = Math.max(1, ...TR.map(t => t.memberCount));
  const list = TR.filter(t => (!sp || t.specialization === sp) && (!st || (st === 'active') === t.isActive));
  $('#trainerGrid').innerHTML = list.map(t => `<article class="card ${t.isActive ? '' : 'dim'}"><div class="dh"><span class="av">${esc(initials(t.fullName))}</span><div><h3>${esc(t.fullName)}</h3><small>${esc(t.specialization)} · ${t.experienceYears}y</small></div></div><div class="bar2"><i style="width:${(t.memberCount / max) * 100}%"></i></div><p class="d">${t.memberCount} member${t.memberCount === 1 ? '' : 's'}${t.isActive ? '' : ' · inactive'}</p><div class="row"><button class="btn ghost sm" data-topen="${esc(t.id)}">View profile</button></div></article>`).join('') || '<p class="empty" style="padding:0 clamp(16px,4vw,48px)">No trainers match.</p>';
};
async function loadTrainers() {
  $('#addTrainer').hidden = !isAdmin(); $('#trainerGrid').innerHTML = '<div class="sk"></div>'.repeat(3);
  try { TR = (await api('/trainers')).data; const cur = $('#tSpec').value;
    $('#tSpec').innerHTML = '<option value="">All specializations</option>' + [...new Set(TR.map(t => t.specialization))].map(s => `<option ${s === cur ? 'selected' : ''}>${esc(s)}</option>`).join('');
    drawTrainers(); if (!RM) gsap.from('#trainerGrid .card', { y: 24, opacity: 0, stagger: .07, duration: .6, ease: 'power3.out' });
  } catch (e) { if (!authFail(e)) $('#trainerGrid').innerHTML = `<p class="empty" style="color:var(--danger)">Could not load trainers: ${esc(e.message)}</p>`; }
}
async function openTrainer(id) {
  const box = $('#detailBody'); box.innerHTML = '<div class="sk"></div>'; if (!$('#detailDlg').open) $('#detailDlg').showModal();
  try {
    const t = (await api('/trainers/' + id)).data, others = TR.filter(x => x.id !== id && x.isActive);
    box.innerHTML = `<div class="dh"><span class="av lg">${esc(initials(t.fullName))}</span><div><h2>${esc(t.fullName)}</h2><small>${esc(t.specialization)} · <span class="pill ${t.isActive ? 'ok' : ''}">${t.isActive ? 'active' : 'inactive'}</span></small></div></div>
    ${isAdmin() ? '<div class="row" style="justify-content:flex-start;margin-bottom:16px"><button class="btn ghost" id="tEdit">Edit</button><button class="btn ghost" id="tDel">Delete</button></div>' : ''}
    <dl class="kv"><dt>Email</dt><dd>${esc(t.email)}</dd><dt>Phone</dt><dd>${esc(t.phone ?? '—')}</dd><dt>Experience</dt><dd>${t.experienceYears} years</dd><dt>Certifications</dt><dd>${esc(t.certifications ?? '—')}</dd><dt>Notes</dt><dd>${esc(t.notes ?? '—')}</dd></dl>
    <h3>Assigned members (${t.members.length})</h3><ul class="list">${t.members.map(m => `<li><button class="lnk" data-open-member="${esc(m.id)}">${esc(m.fullName)}</button><small>${esc(m.code)}</small></li>`).join('') || '<li class="empty">No members assigned.</li>'}</ul>
    ${isAdmin() && t.members.length ? `<div class="rn"><select id="rsTo" aria-label="Reassign to"><option value="">Unassigned</option>${others.map(o => `<option value="${esc(o.id)}">${esc(o.fullName)}</option>`).join('')}</select><button class="btn ghost" id="rsGo">Reassign all members</button></div>` : ''}`;
    if ($('#tEdit')) $('#tEdit').onclick = () => { $('#detailDlg').close(); openDlg('#trDlg', 'Edit trainer', '#trTitle', '#trForm', t, ['fullName', 'email', 'phone', 'specialization', 'experienceYears', 'certifications', 'notes']); };
    if ($('#tDel')) $('#tDel').onclick = async () => { if (!(await ask(`Delete ${t.fullName}?`))) return;
      try { await api('/trainers/' + id, { method: 'DELETE' }); $('#detailDlg').close(); toast('Trainer deleted'); loadTrainers(); } catch (e) { toast(e.message, true); } };
    if ($('#rsGo')) $('#rsGo').onclick = async () => { if (!(await ask(`Move all ${t.members.length} members?`))) return;
      try { const r = await api(`/trainers/${id}/reassign`, { method: 'POST', body: { toTrainerId: $('#rsTo').value || null } }); toast(`${r.data.moved} members reassigned ✓`); loadTrainers(); openTrainer(id); } catch (e) { toast(e.message, true); } };
  } catch (e) { if (!authFail(e)) box.innerHTML = `<p class="empty" style="color:var(--danger)">${esc(e.message)}</p>`; }
}
wireForm('#trForm', v => { const e = {};
  if (v.fullName.trim().length < 2) e.fullName = 'Enter the full name';
  if (!/^\S+@\S+\.\S+$/.test(v.email.trim())) e.email = 'Enter a valid email';
  if (v.specialization.trim().length < 2) e.specialization = 'Enter a specialization'; return e; },
  async (v, id) => { const body = { fullName: v.fullName.trim(), email: v.email.trim(), specialization: v.specialization.trim(), experienceYears: +v.experienceYears || 0, isActive: v.isActive };
    for (const k of ['phone', 'certifications', 'notes']) if (v[k]) body[k] = v[k];
    await api(id ? '/trainers/' + id : '/trainers', { method: id ? 'PATCH' : 'POST', body }); toast(id ? 'Trainer updated ✓' : 'Trainer added ✓'); loadTrainers(); });

/* ---------- Payments ---------- */
const IST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const P = { page: 1, q: '', status: '', method: '', month: IST().slice(0, 7) }; let payKey = '';
const PCLS = { PAID: 'ok', FAILED: 'bad', PENDING: 'warn', REFUNDED: 'warn' };
async function loadPayments() {
  $('#pMonth').value = P.month; const tb = $('#pBody'); tb.innerHTML = '<tr><td colspan="7"><div class="sk"></div></td></tr>';
  try {
    const qs = new URLSearchParams({ page: P.page, pageSize: 10, ...(P.q && { q: P.q }), ...(P.status && { status: P.status }), ...(P.method && { method: P.method }), ...(P.month && { month: P.month }) });
    const reqs = [api('/payments?' + qs)];
    if (P.month) { const [y, m] = P.month.split('-'); reqs.push(api(`/analytics/revenue?range=custom&from=${P.month}-01&to=${new Date(Date.UTC(+y, +m, 0)).toISOString().slice(0, 10)}`)); }
    const [j, rv] = await Promise.all(reqs);
    $('#paySum').textContent = rv ? `Net revenue ${fmt(rv.data.totals.revenue)} · Outstanding ${fmt(rv.data.totals.dues)} (paid − refunded; pending shown as dues)` : '';
    tb.innerHTML = j.data.length ? j.data.map(p => `<tr><td>${esc(p.receiptNo)}</td><td><button class="lnk" data-open-member="${esc(p.memberId)}">${esc(p.member.fullName)}<small>${esc(p.member.code)}</small></button></td><td>${d10(p.paidOn)}</td><td>${p.status === 'REFUNDED' ? '−' : ''}${fmt(p.amount)}</td><td>${esc(p.method.replace('_', ' ').toLowerCase())}</td><td><span class="pill ${PCLS[p.status]}">${p.status.toLowerCase()}</span></td><td><button class="btn ghost sm" data-rcpt="${esc(p.id)}">Receipt</button>${p.status === 'PENDING' ? `<button class="btn ghost sm" data-pset="PAID:${esc(p.id)}">Mark paid</button><button class="btn ghost sm" data-pset="FAILED:${esc(p.id)}">Failed</button>` : ''}${p.status === 'PAID' && isAdmin() ? `<button class="btn ghost sm" data-refund="${esc(p.id)}">Refund</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">No payments match these filters.</td></tr>';
    const pages = Math.max(1, Math.ceil(j.meta.total / 10));
    $('#pPager').innerHTML = `<span>${j.meta.total} payment${j.meta.total === 1 ? '' : 's'} · page ${P.page}/${pages}</span><button class="btn ghost" data-ppg="-1" ${P.page <= 1 ? 'disabled' : ''}>Prev</button><button class="btn ghost" data-ppg="1" ${P.page >= pages ? 'disabled' : ''}>Next</button>`;
  } catch (e) { if (!authFail(e)) tb.innerHTML = `<tr><td colspan="7" class="empty" style="color:var(--danger)">Could not load payments: ${esc(e.message)}</td></tr>`; }
}
async function printReceipt(id) {
  try { const p = (await api('/payments/' + id)).data;
    $('#receipt').innerHTML = `<h2>IRONFLOW — ${p.status === 'REFUNDED' ? 'Refund' : 'Payment'} receipt</h2><table><tr><td>Receipt no.</td><td>${esc(p.receiptNo)}</td></tr><tr><td>Member</td><td>${esc(p.member.fullName)} (${esc(p.member.code)})</td></tr><tr><td>Date</td><td>${d10(p.paidOn)}</td></tr><tr><td>Amount</td><td><b>${fmt(p.amount)}</b></td></tr><tr><td>Method</td><td>${esc(p.method.replace('_', ' '))}</td></tr><tr><td>Status</td><td>${esc(p.status)}</td></tr><tr><td>Description</td><td>${esc(p.description ?? '—')}</td></tr></table><p style="margin-top:24px;font-size:12px">Recorded manually by gym staff. This is not a bank or payment-gateway confirmation.</p>`;
    setTimeout(() => print(), 50);
  } catch (e) { if (!authFail(e)) toast(e.message, true); }
}
function openPay() {
  const f = $('#pForm'); f.reset(); fieldErr('#pForm', {}); f.querySelector('.form-err').textContent = ''; f.elements.paidOn.value = IST(); $('#pMem').innerHTML = '<option value="">Search above…</option>'; payKey = crypto.randomUUID(); $('#payDlg').showModal();
}
let pt;
$('#pMemQ').oninput = e => { clearTimeout(pt); pt = setTimeout(async () => { const q = e.target.value.trim(); if (!q) return;
  try { const m = (await api('/members?pageSize=8&q=' + encodeURIComponent(q))).data; $('#pMem').innerHTML = m.length ? m.map(x => `<option value="${esc(x.id)}">${esc(x.fullName)} · ${esc(x.code)}</option>`).join('') : '<option value="">No matches</option>'; } catch {} }, 300); };
wireForm('#pForm', v => { const e = {};
  if (!v.memberId) e.memberId = 'Search and select a member'; if (!(+v.amount > 0)) e.amount = 'Enter an amount above 0'; if (!v.paidOn) e.paidOn = 'Choose a date'; return e; },
  async v => { const body = { memberId: v.memberId, amount: +v.amount, paidOn: v.paidOn, method: v.method, status: v.status, idempotencyKey: payKey }; if (v.description) body.description = v.description;
    const j = await api('/payments', { method: 'POST', body }); toast(j.duplicate ? 'Already recorded — no duplicate created' : `Payment ${j.data.receiptNo} recorded ✓`); loadPayments(); });
let qt; const pr = () => { P.page = 1; loadPayments(); };
$('#pQ').oninput = e => { clearTimeout(qt); qt = setTimeout(() => { P.q = e.target.value.trim(); pr(); }, 300); };
$('#pStatus').onchange = e => { P.status = e.target.value; pr(); }; $('#pMethod').onchange = e => { P.method = e.target.value; pr(); }; $('#pMonth').onchange = e => { P.month = e.target.value; pr(); };

/* ---------- delegated actions ---------- */
$('#tSpec').onchange = $('#tStat').onchange = drawTrainers;
$('#addPlan').onclick = () => openDlg('#planDlg', 'New plan', '#plTitle', '#plForm'); $('#addTrainer').onclick = () => openDlg('#trDlg', 'Add trainer', '#trTitle', '#trForm'); $('#addPay').onclick = openPay;
document.addEventListener('click', async e => {
  const g = k => e.target.closest(`[data-${k}]`)?.dataset[k];
  let v;
  if ((v = g('pedit'))) { const p = PLANS.find(x => x.id === v); openDlg('#planDlg', 'Edit plan', '#plTitle', '#plForm', { ...p, benefits: p.benefits.join('\n') }, ['name', 'durationDays', 'price', 'description', 'benefits']); }
  else if ((v = g('ptoggle'))) { const p = PLANS.find(x => x.id === v);
    if (p.isActive && !(await ask(`Archive ${p.name}? Existing memberships keep their price and dates.`))) return;
    try { await api('/plans/' + v, { method: 'PATCH', body: { isActive: !p.isActive } }); toast(p.isActive ? 'Plan archived' : 'Plan restored'); loadPlans(); } catch (er) { toast(er.message, true); } }
  else if ((v = g('topen'))) openTrainer(v);
  else if ((v = g('rcpt'))) printReceipt(v);
  else if ((v = g('pset'))) { const [s, id] = v.split(':');
    try { await api('/payments/' + id, { method: 'PATCH', body: { status: s } }); toast(s === 'PAID' ? 'Marked as paid ✓' : 'Marked as failed'); loadPayments(); } catch (er) { toast(er.message, true); loadPayments(); } }
  else if ((v = g('refund'))) openRefund(v);
  else if ((v = g('ppg'))) { P.page += +v; loadPayments(); }
});
