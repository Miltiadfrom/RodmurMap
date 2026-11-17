// Геометрия редактора: сглаженные контуры, русла с устьем, россыпь знаков внутри леса.

/** Детерминированный шум — одна и та же правка всегда рисуется одинаково. */
export function rng(seed) {
  let h = 2166136261;
  const text = String(seed);
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Кривая Катмулла — Рома через точки, замкнутая или открытая. */
export function smoothPath(points, closed = false, tension = 1) {
  const pts = points.map(p => (Array.isArray(p) ? p : [p.x, p.y]));
  if (pts.length < 2) return "";
  if (pts.length === 2) return `M${fmt(pts[0])}L${fmt(pts[1])}`;
  const at = i => {
    if (closed) return pts[(i + pts.length) % pts.length];
    return pts[Math.max(0, Math.min(pts.length - 1, i))];
  };
  const last = closed ? pts.length : pts.length - 1;
  let d = `M${fmt(pts[0])}`;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension];
    const c2 = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension];
    d += `C${fmt(c1)} ${fmt(c2)} ${fmt(p2)}`;
  }
  return closed ? `${d}Z` : d;
}

const fmt = p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

/** Русло: исток тонкий, устье широкое — как на гравированной подложке. */
export function riverPath(points, width = 2) {
  const pts = points.map(p => (Array.isArray(p) ? p : [p.x, p.y]));
  if (pts.length < 2) return "";
  // сглаживаем русло повторной выборкой, чтобы ширина менялась плавно
  const dense = resample(pts, Math.max(2, Math.min(160, pts.length * 6)));
  const left = [];
  const right = [];
  for (let i = 0; i < dense.length; i++) {
    const prev = dense[Math.max(0, i - 1)];
    const next = dense[Math.min(dense.length - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const t = i / (dense.length - 1);
    const half = (width * (0.22 + 0.78 * Math.pow(t, 0.75))) / 2;
    left.push([dense[i][0] + nx * half, dense[i][1] + ny * half]);
    right.push([dense[i][0] - nx * half, dense[i][1] - ny * half]);
  }
  const back = right.reverse();
  const tail = smoothPath(back).replace(/^M[^CL]*/, "");
  return `${smoothPath(left)}L${fmt(back[0])}${tail}Z`;
}

/** Равномерная выборка ломаной — нужна для русла и для подписи вдоль реки. */
export function resample(points, count) {
  const pts = points.map(p => (Array.isArray(p) ? p : [p.x, p.y]));
  if (pts.length < 2) return pts.slice();
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + dist(pts[i - 1], pts[i]));
  const total = lengths[lengths.length - 1] || 1;
  const out = [];
  for (let i = 0; i < count; i++) {
    const target = (total * i) / (count - 1);
    let j = 1;
    while (j < lengths.length - 1 && lengths[j] < target) j++;
    const span = lengths[j] - lengths[j - 1] || 1;
    const t = (target - lengths[j - 1]) / span;
    out.push([
      pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * t,
      pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * t
    ]);
  }
  return out;
}

export function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

export function polygonBounds(points) {
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function polygonArea(points) {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  }
  return Math.abs(sum / 2);
}

/** Центр контура: среднее вершин, подтянутое внутрь, если оно вышло за берег. */
export function polygonCenter(points) {
  const box = polygonBounds(points);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  if (pointInPolygon(cx, cy, points)) return [cx, cy];
  const avg = points.reduce((a, p) => [a[0] + p[0] / points.length, a[1] + p[1] / points.length], [0, 0]);
  if (pointInPolygon(avg[0], avg[1], points)) return avg;
  return points[0];
}

/** Россыпь знаков внутри леса: сетка с дрожанием, отсев по контуру. */
export function scatterInside(points, spacing, seed, limit = 900) {
  const box = polygonBounds(points);
  const random = rng(seed);
  const out = [];
  const step = Math.max(6, spacing);
  for (let y = box.y + step * 0.5; y < box.y + box.height; y += step) {
    for (let x = box.x + step * 0.5; x < box.x + box.width; x += step) {
      const jx = x + (random() - 0.5) * step * 0.85;
      const jy = y + (random() - 0.5) * step * 0.85;
      if (!pointInPolygon(jx, jy, points)) continue;
      out.push({ x: +jx.toFixed(1), y: +jy.toFixed(1), r: random() });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Подпись вдоль русла: точка и наклон в середине реки. */
export function alongPath(points, ratio = 0.5) {
  const pts = points.map(p => (Array.isArray(p) ? p : [p.x, p.y]));
  if (pts.length < 2) return { x: pts[0]?.[0] ?? 0, y: pts[0]?.[1] ?? 0, angle: 0 };
  const dense = resample(pts, 40);
  const index = Math.max(1, Math.min(dense.length - 2, Math.round((dense.length - 1) * ratio)));
  const a = dense[index - 1];
  const b = dense[index + 1];
  let angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return { x: dense[index][0], y: dense[index][1], angle };
}

/** Упрощение ломаной (Рамер — Дуглас — Пекер): кисть даёт сотни точек, храним десятки. */
export function simplify(points, tolerance = 2) {
  if (points.length < 3) return points.slice();
  const keep = new Set([0, points.length - 1]);
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let index = -1;
    let max = 0;
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = first + 1; i < last; i++) {
      const d = Math.abs((points[i][0] - ax) * dy - (points[i][1] - ay) * dx) / len;
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (max > tolerance && index > 0) {
      keep.add(index);
      stack.push([first, index], [index, last]);
    }
  }
  return [...keep].sort((a, b) => a - b).map(i => points[i]);
}