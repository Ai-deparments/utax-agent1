// SVG grafiklar — tashqi kutubxonasiz. Ranglar --s1..--s8 (tasdiqlangan palitra, qat'iy tartibda).
import { h, fmt, short } from './ui.js';
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v); for (const k of kids.flat()) if (k) e.append(k); return e; };
const txt = (x, y, t, attrs = {}) => { const e = s('text', { x, y, ...attrs }); e.textContent = t; return e; };
function niceTicks(min, max, n = 5) { if (max === min) max = min + 1; const span = max - min; const step0 = span / n; const mag = Math.pow(10, Math.floor(Math.log10(step0))); const norm = step0 / mag; const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag; const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step; const t = []; for (let v = lo; v <= hi + step / 2; v += step) t.push(Math.round(v * 1e6) / 1e6); return t; }
function tip(container) { const t = h('div', { class: 'tip' }); container.append(t); return { show(x, y, html) { t.innerHTML = html; t.style.display = 'block'; t.style.left = x + 'px'; t.style.top = y + 'px'; }, hide() { t.style.display = 'none'; } }; }
function legend(series) { return h('div', { class: 'legend' }, ...series.map((sr, i) => h('span', {}, h('i', { style: { background: sr.color || SERIES[i] } }), sr.name))); }
const fmtV = (v, money) => (money ? fmt(v) : String(v));

/** Sparkline (KPI karta ichida) */
export function sparkline(values, { color = 'var(--s1)', height = 44, width = 200 } = {}) {
  const W = width, H = height, P = 3;
  const min = Math.min(...values), max = Math.max(...values);
  const X = (i) => P + (i * (W - 2 * P)) / Math.max(1, values.length - 1), Y = (v) => (max === min ? H / 2 : P + (H - 2 * P) - ((v - min) / (max - min)) * (H - 2 * P));
  const pts = values.map((v, i) => [X(i), Y(v)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const gid = 'sg' + Math.random().toString(36).slice(2, 8);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' });
  svg.append(s('defs', {}, s('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': .22 }), s('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }))));
  svg.append(s('path', { d: `${d} L${pts[pts.length - 1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`, fill: `url(#${gid})` }));
  svg.append(s('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
  return svg;
}

/** Line/area: {labels:[], series:[{name, values, color, area}], height, money} */
export function lineChart({ labels, series, height = 240, money = true, yFmt = short }) {
  const W = 720, H = height, P = { l: 58, r: 14, t: 14, b: 28 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const allV = series.flatMap((x) => x.values);
  const ticks = niceTicks(Math.min(0, ...allV), Math.max(1, ...allV));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const X = (i) => P.l + (labels.length > 1 ? (i * iw) / (labels.length - 1) : iw / 2), Y = (v) => P.t + ih - ((v - y0) / (y1 - y0)) * ih;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}` });
  const g = s('g', { class: 'grid' }); for (const t of ticks) { g.append(s('line', { x1: P.l, x2: W - P.r, y1: Y(t), y2: Y(t) })); svg.append(txt(P.l - 8, Y(t) + 4, yFmt(t), { 'text-anchor': 'end' })); }
  svg.append(g);
  svg.append(s('g', { class: 'axis' }, s('line', { x1: P.l, x2: W - P.r, y1: Y(0), y2: Y(0) })));
  labels.forEach((l, i) => svg.append(txt(X(i), H - 8, l, { 'text-anchor': 'middle' })));
  series.forEach((sr, si) => {
    const color = sr.color || SERIES[si];
    const pts = sr.values.map((v, i) => [X(i), Y(v)]);
    if (sr.area) svg.append(s('path', { d: `M${pts[0][0]},${Y(0)} ` + pts.map((p) => `L${p[0]},${p[1]}`).join(' ') + ` L${pts[pts.length - 1][0]},${Y(0)} Z`, fill: color, opacity: .1 }));
    svg.append(s('path', { d: pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join(' '), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    pts.forEach((p) => svg.append(s('circle', { cx: p[0], cy: p[1], r: 3.5, fill: color, stroke: '#fff', 'stroke-width': 2 })));
  });
  const wrap = h('div', { class: 'chart' }, svg);
  const tp = tip(wrap);
  const cross = s('line', { y1: P.t, y2: P.t + ih, stroke: 'var(--axis)', 'stroke-dasharray': '3 3', style: 'display:none' }); svg.append(cross);
  svg.addEventListener('mousemove', (e) => { const r = svg.getBoundingClientRect(); const mx = ((e.clientX - r.left) / r.width) * W; let best = 0, bd = 1e9; labels.forEach((_, i) => { const d = Math.abs(X(i) - mx); if (d < bd) { bd = d; best = i; } }); cross.setAttribute('x1', X(best)); cross.setAttribute('x2', X(best)); cross.style.display = ''; tp.show(((X(best)) / W) * r.width, (P.t / H) * r.height, `<b>${labels[best]}</b><br>` + series.map((sr, i) => `<span style="color:${sr.color || SERIES[i]}">●</span> ${sr.name}: <b>${fmtV(sr.values[best], money)}</b>`).join('<br>')); });
  svg.addEventListener('mouseleave', () => { tp.hide(); cross.style.display = 'none'; });
  return h('div', {}, wrap, series.length > 1 ? legend(series) : null);
}

/** Grouped/stacked bars: {labels, series:[{name, values, color}], height} */
export function barChart({ labels, series, height = 240, money = true, yFmt = short, stacked = false }) {
  const W = 720, H = height, P = { l: 58, r: 14, t: 14, b: 28 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const maxV = stacked ? Math.max(...labels.map((_, i) => series.reduce((a, sr) => a + Math.max(0, sr.values[i] || 0), 0))) : Math.max(...series.flatMap((x) => x.values));
  const minV = Math.min(0, ...series.flatMap((x) => x.values));
  const ticks = niceTicks(minV, Math.max(1, maxV));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const Y = (v) => P.t + ih - ((v - y0) / (y1 - y0)) * ih;
  const gw = iw / labels.length, bw = stacked ? gw * 0.55 : Math.min(26, (gw * 0.7) / series.length);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}` });
  const g = s('g', { class: 'grid' }); for (const t of ticks) { g.append(s('line', { x1: P.l, x2: W - P.r, y1: Y(t), y2: Y(t) })); svg.append(txt(P.l - 8, Y(t) + 4, yFmt(t), { 'text-anchor': 'end' })); } svg.append(g);
  svg.append(s('g', { class: 'axis' }, s('line', { x1: P.l, x2: W - P.r, y1: Y(0), y2: Y(0) })));
  const wrap = h('div', { class: 'chart' }, svg); const tp = tip(wrap);
  labels.forEach((l, i) => {
    const cx = P.l + gw * i + gw / 2;
    svg.append(txt(cx, H - 8, l, { 'text-anchor': 'middle' }));
    let acc = 0;
    series.forEach((sr, si) => {
      const v = sr.values[i] || 0; const color = sr.color || SERIES[si];
      let x, y, hgt;
      if (stacked) { x = cx - bw / 2; const top = Y(acc + Math.max(0, v)); hgt = Math.max(0, Y(acc) - top); y = top; acc += Math.max(0, v); }
      else { x = cx - (series.length * bw) / 2 + si * bw + 1; y = Math.min(Y(v), Y(0)); hgt = Math.abs(Y(v) - Y(0)); }
      const rect = s('rect', { x, y, width: Math.max(1, bw - 2), height: Math.max(0, hgt), rx: 3, fill: color, stroke: '#fff', 'stroke-width': stacked ? 2 : 0 });
      rect.addEventListener('mouseenter', () => { const r = svg.getBoundingClientRect(); tp.show(((x + bw / 2) / W) * r.width, (y / H) * r.height, `<b>${l}</b><br>${sr.name}: <b>${fmtV(v, money)}</b>`); rect.setAttribute('opacity', .8); });
      rect.addEventListener('mouseleave', () => { tp.hide(); rect.removeAttribute('opacity'); });
      svg.append(rect);
    });
  });
  return h('div', {}, wrap, series.length > 1 ? legend(series) : null);
}

/** Donut: {items:[{name, value, color}], size, money, centerLabel} */
export function donutChart({ items, size = 150, money = true, centerLabel = 'jami' }) {
  const total = items.reduce((a, x) => a + Math.max(0, x.value), 0) || 1;
  const R = 82, r = 58, C = 100;
  const svg = s('svg', { viewBox: '0 0 200 200', style: `width:${size}px;height:${size}px;flex:none` });
  let a0 = -Math.PI / 2;
  const wrap = h('div', { class: 'chart donut-wrap' }); const tp = tip(wrap);
  const lg = h('div', { class: 'donut-legend' });
  items.forEach((it, i) => {
    const frac = Math.max(0, it.value) / total; const a1 = a0 + frac * Math.PI * 2; const color = it.color || SERIES[i % 8];
    const big = frac > 0.5 ? 1 : 0; const gap = frac > 0.02 ? 0.02 : 0;
    const p = (ang, rad) => [C + rad * Math.cos(ang), C + rad * Math.sin(ang)];
    const [x0, y0] = p(a0 + gap, R), [x1, y1] = p(a1 - gap, R), [x2, y2] = p(a1 - gap, r), [x3, y3] = p(a0 + gap, r);
    if (frac > 0.004) { const path = s('path', { d: `M${x0},${y0} A${R},${R} 0 ${big} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${big} 0 ${x3},${y3} Z`, fill: color }); path.addEventListener('mouseenter', (e) => { const rc = wrap.getBoundingClientRect(); tp.show(e.clientX - rc.left, e.clientY - rc.top, `<b>${it.name}</b><br>${fmtV(it.value, money)} (${(frac * 100).toFixed(1)}%)`); path.setAttribute('opacity', .8); }); path.addEventListener('mouseleave', () => { tp.hide(); path.removeAttribute('opacity'); }); svg.append(path); }
    lg.append(h('div', { class: 'row' }, h('i', { style: { background: color } }), h('span', {}, it.name), h('span', { class: 'p' }, (frac * 100).toFixed(0) + '%'), h('span', { class: 'a' }, money ? short(it.value) + ' ' : it.value)));
    a0 = a1;
  });
  svg.append(txt(C, C - 3, money ? short(total) : fmt(total), { 'text-anchor': 'middle', class: 'lbl', style: 'font-size:15px;font-weight:700' }), txt(C, C + 14, centerLabel, { 'text-anchor': 'middle', style: 'font-size:11px' }));
  wrap.append(svg, lg);
  return wrap;
}

/** Gorizontal barlar (aging va h.k.): {items:[{label, value, color, sub}]} */
export function hBarChart({ items, money = true }) {
  const max = Math.max(1, ...items.map((x) => x.value));
  return h('div', { class: 'hbar' }, ...items.map((it, i) => h('div', { class: 'r' }, h('span', { class: 'lbl' }, it.label), h('div', { class: 'bar' }, h('i', { style: { width: (it.value / max) * 100 + '%', background: it.color || SERIES[i % 8] } })), h('span', { class: 'tnum right' }, (money ? short(it.value) : it.value) + (it.sub ? ` · ${it.sub}` : '')))));
}

/** Reja/fakt qatorlar: [{name, plan, fact, pct, status, diff}] — variance ko'rinishi */
export function planFact(items, { lowerIsBetter = () => false } = {}) {
  const col = (st) => (st === 'OK' ? 'good' : st === 'WARN' ? 'warn' : st === 'BAD' ? 'crit' : '');
  return h('div', { style: { display: 'grid', gap: '12px' } }, ...items.map((it) => h('div', {}, h('div', { class: 'flex between small' }, h('b', {}, it.name), h('span', { class: 'tnum muted' }, `Reja ${short(it.plan)} · Fakt ${short(it.fact)} · `, h('b', { class: col(it.status) === 'good' ? 'pos' : col(it.status) === 'crit' ? 'neg' : col(it.status) === 'warn' ? 'warnc' : '' }, it.plan ? it.pct + '%' : '—'))), h('div', { class: 'prog ' + col(it.status), style: { height: '9px', marginTop: '5px' } }, h('i', { style: { width: Math.min(100, it.pct || 0) + '%' } })))));
}
