const CONFIG = { currency: 'INR', locale: 'en-IN' }; // centralised currency formatting
const fmt = n => new Intl.NumberFormat(CONFIG.locale, { style: 'currency', currency: CONFIG.currency, maximumFractionDigits: 0 }).format(n ?? 0);
const $ = s => document.querySelector(s), RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let user = null;

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, { credentials: 'same-origin', ...opts, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ironflow' } , body: opts.body && JSON.stringify(opts.body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || 'Request failed'), { status: r.status, details: j.error?.details });
  return j;
}
function toast(msg, err) {
  const t = Object.assign(document.createElement('div'), { className: 'toast' + (err ? ' err' : ''), textContent: msg });
  $('#toasts').append(t); gsap.from(t, { x: 40, opacity: 0, duration: RM ? 0 : .4, ease: 'power3.out' });
  setTimeout(() => gsap.to(t, { opacity: 0, y: 8, duration: RM ? 0 : .3, onComplete: () => t.remove() }), 3500);
}
const icons = () => lucide.createIcons();

/* ---------- landing motion ---------- */
function intro() {
  gsap.registerPlugin(ScrollTrigger);
  if (RM) return;
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
  tl.from('.orbits', { opacity: 0, duration: .8 })
    .from('.o', { scale: .8, transformOrigin: '50% 50%', opacity: 0, stagger: .12, duration: 1 }, 0)
    .from('.bell', { y: 30, opacity: 0, duration: .9 }, .25)
    .from('.ln>span', { yPercent: 110, stagger: .12, duration: 1 }, .2)
    .from('.eyebrow,.lead', { y: 20, opacity: 0, stagger: .1, duration: .8 }, .6)
    .from('.cta .btn', { y: 20, opacity: 0, stagger: .08, duration: .7 }, .75)
    .from('.preview', { y: 40, scale: .96, opacity: 0, duration: 1 }, .85)
    .add(() => document.querySelectorAll('[data-count]').forEach(el => count(el, +el.dataset.count)), .9);
  gsap.utils.toArray('.rv').forEach((el, i) => gsap.from(el, { y: 40, opacity: 0, duration: .9, ease: 'power3.out', delay: (i % 4) * .05, scrollTrigger: { trigger: el, start: 'top 88%', once: true } }));
}
function count(el, to, f) {
  f = f || (v => Math.round(v));
  if (RM) return void (el.textContent = f(to));
  const o = { v: 0 }; gsap.to(o, { v: to, duration: 1.2, ease: 'power2.out', onUpdate: () => (el.textContent = f(o.v)) });
}

/* ---------- cursor (desktop only; native cursor stays) ---------- */
function cursor() {
  if (RM || !matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  const c = $('.cursor'), set = { x: gsap.quickTo(c, 'x', { duration: .25 }), y: gsap.quickTo(c, 'y', { duration: .25 }) };
  addEventListener('pointermove', e => { c.classList.add('on'); set.x(e.clientX); set.y(e.clientY); }, { passive: true });
  document.addEventListener('pointerover', e => c.classList.toggle('big', !!e.target.closest('a,button,[data-magnetic]')));
  document.addEventListener('pointerleave', () => c.classList.remove('on'));
  document.querySelectorAll('[data-magnetic]').forEach(b => {
    const x = gsap.quickTo(b, 'x', { duration: .4, ease: 'power3' }), y = gsap.quickTo(b, 'y', { duration: .4, ease: 'power3' });
    b.addEventListener('pointermove', e => { const r = b.getBoundingClientRect(); x((e.clientX - r.left - r.width / 2) * .2); y((e.clientY - r.top - r.height / 2) * .3); });
    b.addEventListener('pointerleave', () => { x(0); y(0); });
  });
}

/* ---------- theme panel ---------- */
function themeUI() {
  const seg = $('#modeSeg'), sw = $('#swatches'), dlg = $('#themeDlg');
  const draw = () => {
    const s = IFTheme.get(), r = IFTheme.resolved();
    seg.innerHTML = ['dark', 'light', 'system'].map(m => `<button role="radio" aria-checked="${s.mode === m}" data-m="${m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('');
    sw.innerHTML = Object.entries(IFTheme.PRESETS).map(([n, [d, l]]) => `<button class="sw" aria-pressed="${s.accent === n}" data-a="${esc(n)}"><i style="background:${r === 'dark' ? d : l}"></i>${esc(n)}</button>`).join('');
  };
  seg.onclick = e => { const m = e.target.dataset.m; if (m) { IFTheme.set({ mode: m }); draw(); persistPrefs(); } };
  sw.onclick = e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { IFTheme.set({ accent: a }); draw(); persistPrefs(); } };
  $('#customColor').oninput = e => { IFTheme.set({ accent: e.target.value }); draw(); };
  $('#customColor').onchange = persistPrefs;
  $('#themeBtn').onclick = () => { draw(); dlg.showModal(); };
}
function persistPrefs() {
  if (!user) return;
  const s = IFTheme.get(), hex = s.accent.startsWith('#') ? s.accent : IFTheme.PRESETS[s.accent][0];
  api('/notifications/preferences', { method: 'PUT', body: { theme: s.mode, accent: hex } }).catch(() => {});
}

/* ---------- auth + routing ---------- */
function syncAuthUI() {
  $('#authBtn').textContent = user ? 'Log out' : 'Log in';
  if (typeof afterAuth === 'function') afterAuth();
  $('#greet').textContent = user ? `${new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'}, ${user.name}` : 'Welcome';
}
async function route() {
  let r = location.hash.replace('#/', '').split('?')[0] || 'landing';
  if (['dashboard', 'members', 'plans', 'trainers', 'payments', 'renewals', 'analytics', 'settings', 'audit'].includes(r) && !user) { r = 'landing'; $('#loginDlg').showModal(); }
  if (!['landing', 'dashboard', 'members', 'plans', 'trainers', 'payments', 'renewals', 'analytics', 'settings', 'audit'].includes(r)) r = 'landing';
  document.querySelectorAll('.view').forEach(v => (v.hidden = v.id !== r));
  const a = document.querySelector(`#links a[data-route="${r}"]`), bar = $('#bar');
  document.querySelectorAll('#links a').forEach(x => x.classList.toggle('on', x === a));
  if (a) { bar.style.width = a.offsetWidth + 'px'; bar.style.transform = `translateX(${a.offsetLeft}px)`; } else bar.style.width = 0;
  $('#links').classList.remove('open'); scrollTo(0, 0);
  const LD = { members: loadMembers, plans: loadPlans, trainers: loadTrainers, payments: loadPayments, renewals: loadRenewals, analytics: loadAnalytics, settings: loadSettings, audit: loadAudit };
  if (LD[r]) { if (!RM) gsap.from('#' + r, { opacity: 0, y: 24, duration: .6, ease: 'power3.out' }); LD[r](); }
  if (r === 'dashboard') { if (!RM) gsap.from('#dashboard', { opacity: 0, y: 24, duration: .6, ease: 'power3.out' }); loadDashboard(); }
}
function authUI() {
  const dlg = $('#loginDlg'), form = $('#loginForm');
  $('#authBtn').onclick = async () => {
    if (!user) return dlg.showModal();
    await api('/auth/logout', { method: 'POST' }); user = null; syncAuthUI(); location.hash = '#/'; toast('Signed out');
  };
  $('#enterBtn').onclick = () => (user ? (location.hash = '#/dashboard') : dlg.showModal());
  form.onsubmit = async e => {
    e.preventDefault(); const f = new FormData(form), btn = $('#loginSubmit'); $('#loginErr').textContent = '';
    btn.disabled = true; btn.textContent = 'Signing in…';
    try { user = (await api('/auth/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } })).data;
      dlg.close(); form.reset(); syncAuthUI(); toast('Welcome back, ' + user.name); location.hash = '#/dashboard'; route();
    } catch (err) { $('#loginErr').textContent = err.message; }
    btn.disabled = false; btn.textContent = 'Sign in';
  };
  document.querySelectorAll('[data-close]').forEach(b => (b.onclick = () => b.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => e.target === d && d.close()));
  document.querySelectorAll('[data-soon]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); toast('This module arrives in the next stage'); }));
  $('#menuBtn').onclick = () => { const o = $('#links').classList.toggle('open'); $('#menuBtn').setAttribute('aria-expanded', o); };
  addEventListener('keydown', e => e.key === 'Escape' && $('#links').classList.remove('open'));
}

/* ---------- dashboard ---------- */
const charts = {};
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function mkChart(id, type, labels, datasets, extra = {}) {
  charts[id]?.destroy();
  if (!labels.length) return void ($('#' + id).replaceWith(Object.assign(document.createElement('p'), { className: 'empty', id, textContent: 'No data for this period yet.' })));
  charts[id] = new Chart($('#' + id), { type, data: { labels, datasets }, options: { responsive: true, animation: { duration: RM ? 0 : 900 }, ...extra } });
  charts[id]._build = { labels, datasets, type };
  recolor(charts[id]);
}
function recolor(c) {
  const a = css('--accent'), m = css('--muted'), b = css('--border'), t = c.config.type;
  Chart.defaults.color = m; Chart.defaults.font.family = 'Inter';
  c.data.datasets.forEach((d, i) => {
    const shade = `color-mix(in srgb, ${a} ${100 - i * 18}%, ${css('--bg')})`;
    if (t === 'doughnut') d.backgroundColor = c.data.labels.map((_, j) => `color-mix(in srgb, ${a} ${100 - j * 17}%, ${css('--bg')})`), d.borderColor = css('--surface');
    else { d.borderColor = a; d.backgroundColor = t === 'bar' ? a : `color-mix(in srgb, ${a} 15%, transparent)`; }
  });
  if (c.options.scales) Object.values(c.options.scales).forEach(s => { s.grid = { color: b }; s.ticks = { color: m }; });
  c.update('none');
}
addEventListener('themechange', () => Object.values(charts).forEach(c => c?.config && recolor(c)));
const spark = v => { if (v.length < 2) return ''; const mx = Math.max(...v), mn = Math.min(...v), r = mx - mn || 1;
  return `<svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none"><polyline fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" points="${v.map((y, i) => `${(i / (v.length - 1)) * 100},${26 - ((y - mn) / r) * 24}`).join(' ')}"/></svg>`; };

async function loadDashboard() {
  $('#today').textContent = new Date().toLocaleDateString(CONFIG.locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  $('#err').hidden = true; $('#kpis').innerHTML = '<div class="sk"></div>'.repeat(6);
  try {
    const [s, rev, mem, ren, tr, rc] = (await Promise.all([api('/dashboard/stats'), api('/analytics/revenue?range=6m'), api('/analytics/memberships?range=6m'), api('/renewals?within=30'), api('/analytics/trainers'), api('/dashboard/recent')])).map(x => x.data);
    $('#demoBadge').hidden = !s.includesDemoData;
    const delta = s.previousMonthRevenue ? Math.round(((s.monthlyRevenue - s.previousMonthRevenue) / s.previousMonthRevenue) * 100) : null;
    const K = [['users', 'Total members', s.totalMembers, null, 'All time', spark(mem.months.map(m => m.totalMembers))],
      ['activity', 'Active members', s.activeMembers, null, 'Live plans', spark(mem.months.map(m => m.activeMembers))],
      ['clock', 'Expiring in 7 days', s.expiringIn7Days, null, 'Needs follow-up', ''],
      ['indian-rupee', 'Monthly revenue', s.monthlyRevenue, fmt, delta === null ? 'No prior month' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs last month`, spark(rev.months.map(m => m.revenue))],
      ['alert-circle', 'Outstanding dues', s.outstandingDues, fmt, 'Pending payments', ''],
      ['repeat', 'Retention', s.retention, v => Math.round(v) + '%', 'Active ÷ total', spark(mem.months.map(m => m.retentionPct))]];
    $('#kpis').innerHTML = K.map(([i, l, , , d, sp]) => `<div class="kpi"><small>${l}<i data-lucide="${i}"></i></small><b>0</b><span class="d">${d}</span>${sp}</div>`).join('');
    document.querySelectorAll('.kpi b').forEach((b, i) => count(b, K[i][2], K[i][3]));
    if (!RM) gsap.from('.kpi', { y: 24, opacity: 0, stagger: .06, duration: .7, ease: 'power3.out' });
    const lab = mem.months.map(m => m.month);
    mkChart('cGrowth', 'line', lab, [{ label: 'Total members', data: mem.months.map(m => m.totalMembers), fill: true, tension: .35 }], { scales: { y: { beginAtZero: true }, x: {} }, plugins: { legend: { display: false } } });
    mkChart('cRev', 'bar', rev.months.map(m => m.month), [{ label: 'Net revenue', data: rev.months.map(m => m.revenue), borderRadius: 4 }], { scales: { y: { beginAtZero: true }, x: {} }, plugins: { legend: { display: false } } });
    mkChart('cPlan', 'doughnut', rev.byPlan.map(p => p.plan), [{ data: rev.byPlan.map(p => p.revenue) }], { plugins: { legend: { position: 'bottom' } } });
    $('#dashRenewals').innerHTML = ren.length ? ren.slice(0, 6).map(r => `<li><span>${esc(r.member.fullName)}<br><small style="color:var(--muted)">${esc(r.planName)}</small></span><span class="pill ${r.daysLeft <= 7 ? 'bad' : 'warn'}">${r.daysLeft}d</span></li>`).join('') : '<li class="empty">No renewals due in 30 days.</li>';
    $('#dashTrainers').innerHTML = tr.length ? tr.map(t => `<li><span>${esc(t.name)}</span><span class="pill ok">${t.members} members</span></li>`).join('') : '<li class="empty">No active trainers.</li>';
    const L = (el, arr, f, msg) => ($(el).innerHTML = arr.length ? arr.map(f).join('') : `<li class="empty">${msg}</li>`);
    const ps = { PAID: 'ok', PENDING: 'warn', FAILED: 'bad', REFUNDED: 'warn' };
    L('#recentPay', rc.payments, p => `<li><span>${esc(p.member.fullName)}<br><small style="color:var(--muted)">${esc(p.receiptNo)}</small></span><span>${fmt(p.amount)} <span class="pill ${ps[p.status]}">${p.status.toLowerCase()}</span></span></li>`, 'No payments recorded yet.');
    L('#recentMem', rc.members, m => `<li><button class="lnk" data-open-member="${esc(m.id)}">${esc(m.fullName)}</button><small style="color:var(--muted)">${esc(m.code)}</small></li>`, 'No members yet.');
    L('#dueList', rc.dues, p => `<li><span>${esc(p.member.fullName)}</span><span class="pill warn">${fmt(p.amount)}</span></li>`, 'No outstanding dues.');
    icons();
  } catch (e) {
    if (e.status === 401) { user = null; syncAuthUI(); location.hash = '#/'; return toast('Session expired — please sign in', true); }
    $('#kpis').innerHTML = ''; $('#err').hidden = false; $('#err').textContent = 'Could not load dashboard: ' + e.message;
  }
}

/* ---------- boot ---------- */
addEventListener('scroll', () => $('#nav').classList.toggle('scrolled', scrollY > 20), { passive: true });
addEventListener('hashchange', route);
(async () => {
  icons(); themeUI(); authUI(); cursor();
  try { user = (await api('/auth/me')).data; } catch {}
  syncAuthUI(); intro(); route();
})();
