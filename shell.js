/* ---------- top-bar menus ---------- */
const MENUS = [['quickBtn', 'quickMenu'], ['profBtn', 'profMenu']];
const QUICK = [['Add member', () => openForm()], ['Record payment', () => { if (location.hash !== '#/payments') location.hash = '#/payments'; openPay(); }], ['View renewals', () => (location.hash = '#/renewals')],
  ['Add trainer', () => openDlg('#trDlg', 'Add trainer', '#trTitle', '#trForm'), true], ['New plan', () => openDlg('#planDlg', 'New plan', '#plTitle', '#plForm'), true]];
function closeMenus(except) { MENUS.forEach(([b, m]) => { if (m !== except) { $('#' + m).hidden = true; $('#' + b).setAttribute('aria-expanded', 'false'); } }); }
function toggleMenu(b, m) { const el = $('#' + m), open = el.hidden; closeMenus(open ? m : null); $('#bellMenu').hidden = true; el.hidden = !open; $('#' + b).setAttribute('aria-expanded', open);
  if (open) { el.querySelector('button')?.focus(); if (!RM) gsap.from(`#${m} button`, { opacity: 0, y: 8, stagger: .04, duration: .3 }); } }
function shellAuth() {
  const on = !!user; ['searchBtn', 'quickWrap', 'profWrap'].forEach(i => ($('#' + i).hidden = !on)); $('#authBtn').hidden = on; closeMenus(); if (!on) return;
  $('#profBtn').textContent = initials(user.name || 'U');
  $('#quickMenu').innerHTML = QUICK.map((x, i) => [x, i]).filter(([x]) => !x[2] || isAdmin()).map(([x, i]) => `<button class="n" role="menuitem" data-qi="${i}">${x[0]}</button>`).join('');
  $('#profMenu').innerHTML = `<p class="who"><b>${esc(user.name)}</b><small>${esc(user.role)}</small></p><button class="n" role="menuitem" data-pi="settings">Settings</button>${isAdmin() ? '<button class="n" role="menuitem" data-pi="audit">Audit log</button>' : ''}<button class="n" role="menuitem" data-pi="theme">Appearance</button><button class="n" role="menuitem" data-pi="logout">Log out</button>`;
}
const prevAfterAuth = window.afterAuth; window.afterAuth = () => { prevAfterAuth(); shellAuth(); };
document.querySelectorAll('.menu').forEach(m => m.addEventListener('keydown', e => {
  const items = [...m.querySelectorAll('button')], i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); }
  if (e.key === 'Escape') { m.hidden = true; m.previousElementSibling.setAttribute('aria-expanded', 'false'); m.previousElementSibling.focus(); }
}));

/* ---------- global search (Ctrl/Cmd+K or "/") ---------- */
const SX = { items: [], i: -1, t: 0, cache: null }; let st;
async function openSearch() {
  $('#sQ').value = ''; $('#sClear').hidden = true; SX.items = []; $('#sList').innerHTML = '<li class="empty" role="presentation">Start typing to search.</li>'; $('#searchDlg').showModal(); $('#sQ').focus();
  if (!SX.cache) try { const [t, p] = await Promise.all([api('/trainers'), api('/plans')]); SX.cache = { t: t.data, p: p.data }; } catch (e) { authFail(e); }
}
function markSel() { document.querySelectorAll('#sList [role=option]').forEach(li => li.setAttribute('aria-selected', +li.dataset.si === SX.i)); $('#sQ').setAttribute('aria-activedescendant', SX.i >= 0 ? 'so' + SX.i : ''); $('#so' + SX.i)?.scrollIntoView({ block: 'nearest' }); }
function drawSearch(groups) {
  SX.items = groups.flatMap(([, l]) => l); SX.i = SX.items.length ? 0 : -1; let n = 0;
  $('#sList').innerHTML = groups.filter(([, l]) => l.length).map(([g, l]) => `<li class="grp" role="presentation">${g}</li>` + l.map(o => `<li role="option" id="so${n}" data-si="${n++}">${esc(o.label)}<small>${esc(o.sub)}</small></li>`).join('')).join('') || '<li class="empty" role="presentation">No results.</li>'; markSel();
}
async function runSearch(term) {
  const my = ++SX.t; if (!term) return drawSearch([]);
  try {
    const [m, pay] = await Promise.all([api('/members?pageSize=5&q=' + encodeURIComponent(term)), api('/payments?pageSize=4&q=' + encodeURIComponent(term))]); if (my !== SX.t) return;
    const lc = term.toLowerCase(), has = (...f) => f.join(' ').toLowerCase().includes(lc), c = SX.cache || { t: [], p: [] };
    drawSearch([['Members', m.data.map(x => ({ label: x.fullName, sub: `${x.code} · ${x.phone}`, go: () => openMember(x.id) }))],
      ['Trainers', c.t.filter(x => has(x.fullName, x.specialization, x.email)).slice(0, 4).map(x => ({ label: x.fullName, sub: x.specialization, go: async () => { location.hash = '#/trainers'; await loadTrainers(); openTrainer(x.id); } }))],
      ['Plans', c.p.filter(x => has(x.name)).slice(0, 4).map(x => ({ label: x.name, sub: `${fmt(x.price)} · ${x.durationDays} days`, go: () => (location.hash = '#/plans') }))],
      ['Payments', pay.data.map(x => ({ label: x.receiptNo, sub: `${x.member.fullName} · ${fmt(x.amount)}`, go: () => { Object.assign(P, { q: x.receiptNo, month: '', status: '', method: '', page: 1 }); syncP(); location.hash === '#/payments' ? loadPayments() : (location.hash = '#/payments'); } }))]]);
  } catch (e) { if (!authFail(e)) $('#sList').innerHTML = `<li class="empty" style="color:var(--danger)">Search failed: ${esc(e.message)}</li>`; }
}
const choose = i => { const o = SX.items[i]; if (o) { $('#searchDlg').close(); o.go(); } };
$('#sQ').oninput = e => { $('#sClear').hidden = !e.target.value; clearTimeout(st); st = setTimeout(() => runSearch(e.target.value.trim()), 200); };
$('#sQ').onkeydown = e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (SX.items.length) { SX.i = (SX.i + (e.key === 'ArrowDown' ? 1 : -1) + SX.items.length) % SX.items.length; markSel(); } }
  else if (e.key === 'Enter') { e.preventDefault(); choose(SX.i); }
  else if (e.key === 'Escape' && e.target.value) { e.preventDefault(); $('#sClear').click(); }
};
$('#sClear').onclick = () => { $('#sQ').value = ''; $('#sClear').hidden = true; runSearch(''); $('#sQ').focus(); };
$('#sList').onclick = e => { const li = e.target.closest('[data-si]'); if (li) choose(+li.dataset.si); };
addEventListener('keydown', e => {
  if (!user) return; const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing && !document.querySelector('dialog[open]'))) { e.preventDefault(); openSearch(); }
});

/* ---------- settings ---------- */
async function loadSettings() {
  $('#setProfile').innerHTML = `<dt>Name</dt><dd>${esc(user.name)}</dd><dt>Role</dt><dd>${esc(user.role)}</dd>${user.email ? `<dt>Email</dt><dd>${esc(user.email)}</dd>` : ''}`;
  try { const p = (await api('/notifications/preferences')).data; $('#npExp').checked = p.notifyExpiry !== 0 && p.notifyExpiry !== false; $('#npDue').checked = p.notifyDues !== 0 && p.notifyDues !== false; } catch (e) { authFail(e); }
}
$('#npExp').onchange = $('#npDue').onchange = async () => {
  try { await api('/notifications/preferences', { method: 'PUT', body: { notifyExpiry: $('#npExp').checked, notifyDues: $('#npDue').checked } }); toast('Preferences saved ✓'); } catch (e) { if (!authFail(e)) toast(e.message, true); } };
$('#setTheme').onclick = () => $('#themeBtn').click();
$('#pwForm').onsubmit = async e => {
  e.preventDefault(); const f = e.target, v = Object.fromEntries(new FormData(f)), errs = {}, fe = f.querySelector('.form-err'); fe.textContent = '';
  if (!v.current) errs.current = 'Enter your current password'; if (v.new.length < 10) errs.new = 'Use at least 10 characters'; fieldErr('#pwForm', errs); if (Object.keys(errs).length) return;
  const b = f.querySelector('.btn.primary'); b.disabled = true;
  try { await api('/auth/password', { method: 'POST', body: { current: v.current, new: v.new } }); f.reset(); toast('Password updated ✓'); }
  catch (er) { if (!authFail(er)) { fieldErr('#pwForm', serverErrs(er)); fe.textContent = er.message; } } b.disabled = false;
};

/* ---------- filter chips + saved views ---------- */
const SV_KEY = 'ironflow-saved-payment-views', svGet = () => { try { return JSON.parse(localStorage.getItem(SV_KEY)) || {}; } catch { return {}; } }, svSet = o => { try { localStorage.setItem(SV_KEY, JSON.stringify(o)); } catch {} };
const PF = { q: ['Search', v => v], status: ['Status', v => v.toLowerCase()], method: ['Method', v => v.replace('_', ' ').toLowerCase()], month: ['Month', v => v] };
const syncP = () => { $('#pQ').value = P.q; $('#pStatus').value = P.status; $('#pMethod').value = P.method; $('#pMonth').value = P.month; };
const barHost = (id, sel) => $('#' + id) || ($(sel).after(Object.assign(document.createElement('div'), { id, className: 'fbar' })), $('#' + id));
function drawPFbar() {
  const h = barHost('pFbar', '#payments .toolbar'), sv = svGet(), act = Object.keys(PF).filter(k => P[k]);
  h.innerHTML = act.map(k => `<span class="fc">${PF[k][0]}: ${esc(PF[k][1](P[k]))}<button aria-label="Remove ${PF[k][0]} filter" data-fc="${k}">✕</button></span>`).join('') + (act.length ? '<button class="btn ghost sm" data-fsave>Save this view</button>' : '')
    + Object.keys(sv).map(n => `<span class="fc sv"><button data-sv="${esc(n)}" title="Apply saved view">${esc(n)}</button><button aria-label="Delete saved view ${esc(n)}" data-sd="${esc(n)}">✕</button></span>`).join('');
}
function drawTFbar() {
  const h = barHost('tFbar', '#trainers .toolbar'), f = [['tSpec', 'Specialization'], ['tStat', 'Status']].filter(([i]) => $('#' + i).value);
  h.innerHTML = f.map(([i, l]) => `<span class="fc">${l}: ${esc($('#' + i).value)}<button aria-label="Remove ${l} filter" data-tfc="${i}">✕</button></span>`).join('');
}
const _lp = loadPayments; window.loadPayments = async () => { await _lp(); drawPFbar(); };
const _lt = loadTrainers; window.loadTrainers = async () => { await _lt(); drawTFbar(); };
['tSpec', 'tStat'].forEach(i => $('#' + i).addEventListener('change', drawTFbar));
document.addEventListener('click', e => {
  const g = k => e.target.closest(`[data-${k}]`)?.dataset[k]; let v;
  if (e.target.closest('#quickBtn')) toggleMenu('quickBtn', 'quickMenu');
  else if (e.target.closest('#profBtn')) toggleMenu('profBtn', 'profMenu');
  else if (e.target.closest('#searchBtn')) openSearch();
  else if ((v = g('qi')) !== undefined) { closeMenus(); QUICK[+v][1](); }
  else if ((v = g('pi'))) { closeMenus(); v === 'settings' || v === 'audit' ? (location.hash = '#/' + v) : v === 'theme' ? $('#themeBtn').click() : $('#authBtn').click(); }
  else if (!e.target.closest('.menu')) closeMenus();
  if ((v = g('fc'))) { P[v] = ''; P.page = 1; syncP(); loadPayments(); }
  else if ((v = g('tfc'))) { $('#' + v).value = ''; $('#' + v).dispatchEvent(new Event('change')); }
  else if (g('fsave') !== undefined) { const act = Object.keys(PF).filter(k => P[k]), sv = svGet(), name = act.map(k => PF[k][1](P[k])).join(' · '); sv[name] = Object.fromEntries(act.map(k => [k, P[k]])); svSet(sv); drawPFbar(); toast('View saved'); }
  else if ((v = g('sv'))) { Object.assign(P, { q: '', status: '', method: '', month: '', page: 1 }, svGet()[v]); syncP(); loadPayments(); }
  else if ((v = g('sd'))) { const sv = svGet(); delete sv[v]; svSet(sv); drawPFbar(); }
});
