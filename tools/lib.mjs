// Shared helpers for the world generation pipeline.
import { chromium } from "playwright";

export const SRC_W = 1152;
export const SRC_H = 648;

// The nine lands of Rodmur, keyed by the flat colour the author painted them with.
export const REGIONS = [
  { key: "timoraz", rgb: [200, 200, 200] },
  { key: "sarti", rgb: [255, 202, 0] },
  { key: "vostok", rgb: [250, 248, 8] },
  { key: "unyu", rgb: [0, 168, 235] },
  { key: "hink", rgb: [255, 136, 24] },
  { key: "eduk", rgb: [205, 123, 85] },
  { key: "izvestia", rgb: [190, 75, 170] },
  { key: "moanoa", rgb: [0, 184, 64] },
  { key: "sila", rgb: [120, 216, 232] }
];
export const SEA_RGB = [175, 192, 248];

export async function withBrowser(fn) {
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=640"]
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

/** Decode an image file inside Chromium and hand back raw RGBA — no native image deps needed. */
export async function decodeImage(page, base64, mime) {
  return page.evaluate(
    async ([data, type]) => {
      const img = new Image();
      img.src = `data:${type};base64,${data}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < d.length; i += chunk) bin += String.fromCharCode.apply(null, d.subarray(i, i + chunk));
      return { w: c.width, h: c.height, b64: btoa(bin) };
    },
    [base64, mime]
  );
}

/** Classify every pixel of the author's drawing into sea / outline / one of the nine lands. */
export function classify(rgba, w, h) {
  const palette = [SEA_RGB, [10, 10, 10], [252, 252, 252], ...REGIONS.map(r => r.rgb)];
  const id = new Uint8Array(w * h); // 0 sea, 1 ink, 2 paper, 3..11 the nine lands
  for (let p = 0; p < w * h; p++) {
    const o = p * 4;
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < palette.length; k++) {
      const c = palette[k];
      const dr = rgba[o] - c[0];
      const dg = rgba[o + 1] - c[1];
      const db = rgba[o + 2] - c[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    id[p] = best;
  }
  return id;
}

/** Grow coloured land over the black coast outline, then drop text-shaped specks. */
export function landMask(ids, w, h) {
  const land = new Uint8Array(w * h);
  for (let p = 0; p < ids.length; p++) if (ids[p] >= 3) land[p] = 1;

  const near = new Uint8Array(w * h);
  const R = 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!land[y * w + x]) continue;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          if (dx * dx + dy * dy <= R * R) near[yy * w + xx] = 1;
        }
      }
    }
  }
  const out = new Uint8Array(w * h);
  for (let p = 0; p < out.length; p++) out[p] = land[p] || ((ids[p] === 1 || ids[p] === 2) && near[p]) ? 1 : 0;
  return dropSpecks(out, w, h, 60);
}

/** Morphological opening: deletes thin painted strokes (island outlines, border tints). */
export function openMask(mask, w, h, r = 2.5) {
  const inside = distanceField(mask, w, h, 1);
  const core = new Uint8Array(w * h);
  for (let p = 0; p < core.length; p++) core[p] = inside[p] > r ? 1 : 0;
  const toCore = distanceField(core, w, h, 0);
  const out = new Uint8Array(w * h);
  for (let p = 0; p < out.length; p++) out[p] = core[p] || toCore[p] <= r ? 1 : 0;
  return out;
}

/** Fill label-shaped holes: anything the border flood cannot reach is interior. */
export function fillHoles(mask, w, h) {
  const outside = new Uint8Array(w * h);
  const stack = [];
  const seed = p => {
    if (!mask[p] && !outside[p]) {
      outside[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (stack.length) {
    const q = stack.pop();
    const x = q % w;
    const y = (q / w) | 0;
    if (x > 0) seed(q - 1);
    if (x < w - 1) seed(q + 1);
    if (y > 0) seed(q - w);
    if (y < h - 1) seed(q + w);
  }
  const out = new Uint8Array(mask);
  for (let p = 0; p < out.length; p++) if (!mask[p] && !outside[p]) out[p] = 1;
  return out;
}

/** Connected-component filter: anything smaller than `min` pixels is a stray label, not an island. */
export function dropSpecks(mask, w, h, min) {
  const seen = new Uint8Array(w * h);
  const out = new Uint8Array(mask);
  const stack = [];
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || seen[p]) continue;
    stack.length = 0;
    stack.push(p);
    seen[p] = 1;
    const comp = [];
    while (stack.length) {
      const q = stack.pop();
      comp.push(q);
      const x = q % w;
      const y = (q / w) | 0;
      const push = (xx, yy) => {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) return;
        const n = yy * w + xx;
        if (mask[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      };
      push(x + 1, y);
      push(x - 1, y);
      push(x, y + 1);
      push(x, y - 1);
    }
    if (comp.length < min) for (const q of comp) out[q] = 0;
  }
  return out;
}

/** Euclidean-ish distance to the nearest opposite cell, by two chamfer passes. */
export function distanceField(mask, w, h, inside) {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let p = 0; p < d.length; p++) d[p] = (mask[p] ? 1 : 0) === inside ? INF : 0;
  const D1 = 1;
  const D2 = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!d[p]) continue;
      let v = d[p];
      if (x > 0) v = Math.min(v, d[p - 1] + D1);
      if (y > 0) v = Math.min(v, d[p - w] + D1);
      if (x > 0 && y > 0) v = Math.min(v, d[p - w - 1] + D2);
      if (x < w - 1 && y > 0) v = Math.min(v, d[p - w + 1] + D2);
      d[p] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      if (!d[p]) continue;
      let v = d[p];
      if (x < w - 1) v = Math.min(v, d[p + 1] + D1);
      if (y < h - 1) v = Math.min(v, d[p + w] + D1);
      if (x < w - 1 && y < h - 1) v = Math.min(v, d[p + w + 1] + D2);
      if (x > 0 && y < h - 1) v = Math.min(v, d[p + w - 1] + D2);
      d[p] = v;
    }
  }
  return d;
}

/** Deterministic value noise + fBm, so the same seed always raises the same mountains. */
export function makeNoise(seed) {
  const perm = new Uint8Array(512);
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = t => t * t * (3 - 2 * t);
  const grad = (hash, x, y) => ((hash & 1) ? -x : x) + ((hash & 2) ? -y : y);
  const noise2 = (x, y) => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];
    const l1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
    const l2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
    return (l1 + v * (l2 - l1)) * 0.7;
  };
  return (x, y, octaves = 4, lac = 2, gain = 0.5) => {
    let a = 1;
    let f = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += a * noise2(x * f, y * f);
      norm += a;
      a *= gain;
      f *= lac;
    }
    return sum / norm;
  };
}

/** Ramer–Douglas–Peucker on a closed ring. */
export function simplify(points, eps) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    let far = -1;
    let maxD = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((points[i][0] - ax) * dy - (points[i][1] - ay) * dx) / len;
      if (d > maxD) {
        maxD = d;
        far = i;
      }
    }
    if (far > 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Chaikin corner cutting — turns a traced pixel staircase into a drawn coastline. */
export function smoothRing(points, iterations = 2) {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = next;
  }
  return pts;
}

/** Moore-neighbour boundary tracing of every component of a binary mask. */
export function traceContours(mask, w, h, minArea = 60) {
  const seen = new Uint8Array(w * h);
  const rings = [];
  const NB = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]
  ];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    // flood to measure the component and mark it visited
    const stack = [start];
    seen[start] = 1;
    const comp = [];
    let minX = w;
    let minY = h;
    while (stack.length) {
      const q = stack.pop();
      comp.push(q);
      const x = q % w;
      const y = (q / w) | 0;
      if (y < minY || (y === minY && x < minX)) {
        minY = y;
        minX = x;
      }
      for (const [dx, dy] of NB) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const n = yy * w + xx;
        if (mask[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (comp.length < minArea) continue;

    const ring = [];
    let cx = minX;
    let cy = minY;
    let dir = 6;
    const startKey = cy * w + cx;
    let guard = 0;
    do {
      ring.push([cx + 0.5, cy + 0.5]);
      let found = false;
      for (let k = 1; k <= 8; k++) {
        const nd = (dir + k) % 8;
        const xx = cx + NB[nd][0];
        const yy = cy + NB[nd][1];
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || !mask[yy * w + xx]) continue;
        cx = xx;
        cy = yy;
        dir = (nd + 5) % 8;
        found = true;
        break;
      }
      if (!found) break;
      if (++guard > 200000) break;
    } while (cy * w + cx !== startKey);
    if (ring.length > 8) rings.push({ area: comp.length, ring });
  }
  return rings.sort((a, b) => b.area - a.area);
}

export function ringToPath(ring, scale = 1, precision = 1) {
  const f = n => +(n * scale).toFixed(precision);
  return `M${ring.map(([x, y]) => `${f(x)},${f(y)}`).join("L")}Z`;
}

export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
