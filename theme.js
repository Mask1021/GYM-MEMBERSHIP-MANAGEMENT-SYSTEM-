(() => {
  const KEY = 'ironflow-theme', root = document.documentElement;
  // [accent on dark, accent on light] — light variants chosen for text contrast on #F6F6F2/#FFF.
  const PRESETS = { 'Acid Lime': ['#C7FF4A', '#526B20'], 'Electric Blue': ['#4AA8FF', '#1F5FBF'], 'Cyber Violet': ['#A66BFF', '#6A32C9'],
    'Crimson Red': ['#FF4A5E', '#B3162B'], 'Amber Gold': ['#FFC24A', '#8A5A00'], 'Mint Green': ['#4AFFB8', '#0F7A52'] };
  let st = { mode: 'dark', accent: 'Acid Lime' };
  try { st = { ...st, ...JSON.parse(localStorage.getItem(KEY)) }; } catch {}
  const lum = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4); return .2126 * r + .7152 * g + .0722 * b; };
  const cr = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
  const mix = (h, t, k) => '#' + [1, 3, 5].map(i => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - k) + parseInt(t.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
  const fit = (h, dark) => { const bg = dark ? '#1D1D21' : '#ECECE7', t = dark ? '#FFFFFF' : '#000000'; for (let k = 0; k < 20 && cr(h, bg) < 4.5; k++) h = mix(h, t, .08); return h; };
  const resolved = () => st.mode === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : st.mode;
  function apply(animate) {
    if (animate) { root.classList.add('theming'); setTimeout(() => root.classList.remove('theming'), 400); }
    const r = resolved(), hex = PRESETS[st.accent] ? PRESETS[st.accent][r === 'dark' ? 0 : 1] : fit(st.accent, r === 'dark');
    root.dataset.theme = r; root.style.setProperty('--accent', hex);
    root.style.setProperty('--on-accent', cr(hex, '#0A0A0B') >= cr(hex, '#FFFFFF') ? '#0A0A0B' : '#FFFFFF');
    window.dispatchEvent(new Event('themechange'));
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => st.mode === 'system' && apply(true));
  window.IFTheme = { PRESETS, get: () => ({ ...st }), resolved,
    set(p) { st = { ...st, ...p }; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} apply(true); } };
  apply(false);
})();
