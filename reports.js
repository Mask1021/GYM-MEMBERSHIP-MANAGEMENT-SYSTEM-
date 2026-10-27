/* ---------- Analytics ---------- */
const RANGES = [['this_month', 'This month'], ['last_month', 'Last month'], ['3m', 'Last 3 months'], ['6m', 'Last 6 months'], ['year', 'This year'], ['custom', 'Custom']];
const AN = { range: '6m', from: '', to: '', data: null };
const anQS = () => `range=${AN.range}` + (AN.range === 'custom' ? `&from=${AN.from}&to=${AN.to}` : '');
const ensureCanvas = id => { const el = $('#' + id); if (el && el.tagName !== 'CANVAS') { const c = document.createElement('canvas'); c.id = id; c.height = 170; el.replaceWith(c); } };
async function loadAnalytics() {
  $('#anChips').innerHTML = RANGES.map(([v, l]) => `<button data-ar="${v}" aria-pressed="${AN.range === v}">${l}</button>`).join(''); $('#anCustom').hidden = AN.range !== 'custom';
  if (AN.range === 'custom' && !(AN.from && AN.to)) return;
  $('#anKpis').innerHTML = '<div class="sk"></div>'.repeat(4); $('#anErr').hidden = true;
  try {
    const [rv, mb, tr] = (await Promise.all([api('/analytics/revenue?' + anQS()), api('/analytics/memberships?' + anQS()), api('/analytics/trainers')])).map(x => x.data);
    AN.data = { rv, mb }; const sum = k => mb.months.reduce((a, m) => a + m[k], 0), last = mb.months[mb.months.length - 1];
    const K = [['Net revenue', rv.totals.revenue, fmt], ['Outstanding dues', rv.totals.dues, fmt], ['New members', sum('newMembers')], ['Cancellations', sum('cancellations')], ['Renewal rate', mb.renewal.ratePct, v => (v == null ? '—' : Math.round(v) + '%')], ['Retention (latest month)', last?.retentionPct ?? 0, v => Math.round(v) + '%']];
    $('#anKpis').innerHTML = K.map(([l]) => `<div class="kpi"><small>${l}</small><b>0</b></div>`).join('');
    document.querySelectorAll('#anKpis .kpi b').forEach((b, i) => { const [, v, f] = K[i]; v == null ? (b.textContent = f(v)) : count(b, v, f); });
    const ms = mb.months.map(m => m.month), rm = rv.months.map(m => m.month), sc = { y: { beginAtZero: true }, x: {} }, nl = { legend: { display: false } };
    const C = (id, ...a) => { ensureCanvas(id); mkChart(id, ...a); };
    C('cMemNew', 'bar', ms, [{ label: 'New members', data: mb.months.map(m => m.newMembers), borderRadius: 4 }], { scales: sc, plugins: nl });
    C('cMemTot', 'line', ms, [{ label: 'Total', data: mb.months.map(m => m.totalMembers), tension: .35 }, { label: 'Active', data: mb.months.map(m => m.activeMembers), tension: .35, borderDash: [6, 4] }], { scales: sc });
    C('cAnRev', 'bar', rm, [{ label: 'Net revenue', data: rv.months.map(m => m.revenue), borderRadius: 4 }], { scales: sc, plugins: nl });
    C('cAnDues', 'bar', rm, [{ label: 'Dues', data: rv.months.map(m => m.dues), borderRadius: 4 }], { scales: sc, plugins: nl });
    C('cAnPlan', 'doughnut', rv.byPlan.map(p => p.plan), [{ data: rv.byPlan.map(p => p.revenue) }], { plugins: { legend: { position: 'bottom' } } });
    C('cAvE', 'doughnut', ['Active', 'Expired'], [{ data: [mb.activeVsExpired.active, mb.activeVsExpired.expired] }], { plugins: { legend: { position: 'bottom' } } });
    C('cRet', 'line', ms, [{ label: 'Retention %', data: mb.months.map(m => m.retentionPct), tension: .35, fill: true }], { scales: { y: { min: 0, max: 100 }, x: {} }, plugins: nl });
    C('cTr', 'bar', tr.map(t => t.name), [{ label: 'Members', data: tr.map(t => t.members), borderRadius: 4 }], { indexAxis: 'y', scales: { x: { beginAtZero: true }, y: {} }, plugins: nl });
  } catch (e) { if (!authFail(e)) { $('#anKpis').innerHTML = ''; $('#anErr').hidden = false; $('#anErr').textContent = 'Could not load analytics: ' + e.message; } }
}
$('#anCsv').onclick = () => {
  if (!AN.data) return toast('Nothing to export yet', true); const { rv, mb } = AN.data;
  const csv = [['month', 'totalMembers', 'newMembers', 'cancellations', 'activeMembers', 'retentionPct', 'netRevenue', 'dues'], ...mb.months.map((m, i) => [m.month, m.totalMembers, m.newMembers, m.cancellations, m.activeMembers, m.retentionPct, rv.months[i]?.revenue ?? '', rv.months[i]?.dues ?? ''])].map(r => r.join(',')).join('\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `analytics-${AN.range}.csv` }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('#anPrint').onclick = () => { const prev = IFTheme.get().mode; document.body.classList.add('an-print'); IFTheme.set({ mode: 'light' }); setTimeout(() => { print(); IFTheme.set({ mode: prev }); document.body.classList.remove('an-print'); }, 500); };
$('#anApply').onclick = () => { const f = $('#anFrom').value, t = $('#anTo').value; if (!f || !t || f > t) return toast('Choose a valid start and end date', true); AN.from = f; AN.to = t; loadAnalytics(); };

/* ---------- Renewals ---------- */
const RCATS = [['7', 'Within 7 days'], ['15', 'Within 15 days'], ['30', 'Within 30 days'], ['expired', 'Already expired'], ['recent', 'Recently renewed']];
const RN = { cat: '7', data: {} };
const when = r => (r.daysLeft < 0 ? `${-r.daysLeft}d ago` : r.daysLeft === 0 ? 'today' : `in ${r.daysLeft}d`);
const rcls = (r, cat) => (cat === 'recent' ? 'ok' : r.daysLeft <= 7 ? 'bad' : r.daysLeft <= 15 ? 'warn' : 'ok');
const longDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
function drawRn() {
  const l = RN.data[RN.cat] || [];
  $('#rnChips').innerHTML = RCATS.map(([k, t]) => `<button data-rc="${k}" aria-pressed="${RN.cat === k}">${t} (${(RN.data[k] || []).length})</button>`).join('');
  const none = 'No memberships in this category.';
  $('#rnBody').innerHTML = l.length ? l.map(r => `<tr><td><button class="lnk" data-open-member="${esc(r.member.id)}">${esc(r.member.fullName)}<small>${esc(r.member.code)} · ${esc(r.member.phone)}</small></button></td><td>${esc(r.planName)}</td><td>${esc(r.expiresOn)}</td><td><span class="pill ${rcls(r, RN.cat)}">${when(r)}</span></td><td>${RN.cat === 'recent' ? 'Renewed' : r.daysLeft < 0 ? 'Expired' : r.daysLeft <= 7 ? 'Urgent' : 'Upcoming'}</td><td><button class="btn ghost sm" data-open-member="${esc(r.member.id)}">${RN.cat === 'recent' ? 'View' : 'Renew'}</button></td></tr>`).join('') : `<tr><td colspan="6" class="empty">${none}</td></tr>`;
  const groups = new Map(); l.forEach(r => { const k = r.expiresOn; (groups.get(k) || groups.set(k, []).get(k)).push(r); });
  $('#rnTimeline').innerHTML = groups.size ? [...groups].map(([d, rs]) => `<div class="tl-item ${rcls(rs[0], RN.cat)}"><b>${longDate(d)}</b> <small style="color:var(--muted)">· ${when(rs[0])}</small><ul>${rs.map(r => `<li><button data-open-member="${esc(r.member.id)}">${esc(r.member.fullName)}</button></li>`).join('')}</ul></div>`).join('') : `<p class="empty">${none}</p>`;
  if (!RM) gsap.from('#rnTimeline .tl-item', { opacity: 0, x: -14, stagger: .05, duration: .45, ease: 'power2.out' });
}
async function loadRenewals() {
  $('#rnBody').innerHTML = '<tr><td colspan="6"><div class="sk"></div></td></tr>';
  try { const res = await Promise.all(RCATS.map(([k]) => api('/renewals?within=' + k))); RCATS.forEach(([k], i) => (RN.data[k] = res[i].data)); drawRn(); }
  catch (e) { if (!authFail(e)) $('#rnBody').innerHTML = `<tr><td colspan="6" class="empty" style="color:var(--danger)">Could not load renewals: ${esc(e.message)}</td></tr>`; }
}
document.addEventListener('click', e => {
  const r = e.target.closest('[data-ar]')?.dataset.ar; if (r) { AN.range = r; loadAnalytics(); }
  const c = e.target.closest('[data-rc]')?.dataset.rc; if (c) { RN.cat = c; drawRn(); }
});
