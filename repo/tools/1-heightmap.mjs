// Step 1 — rebuild the Rodmur heightmap from the author's drawing.
// The heightmap shipped in the fork encodes the northern half of the continent as deep sea
// (colour -> luminance), so Timoraz, Sarti and the Eastern Kingdom never existed as land.
// Here every painted land colour becomes land, and elevation is sculpted on top of it.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  REGIONS, SRC_W, SRC_H, withBrowser, decodeImage, classify, landMask, distanceField,
  makeNoise, traceContours, simplify, smoothRing, ringToPath, fillHoles, dropSpecks, openMask
} from "./lib.mjs";

const OUT = "tools/out";
mkdirSync("tools/geography", { recursive: true });
mkdirSync(OUT, { recursive: true });
mkdirSync("tools/assets", { recursive: true });

// Mountain spines, in fractions of the drawing. Rivers will run off these.
const RIDGES = [
  { name: "Тиморазский хребет", h: 1.0, w: 0.030, pts: [[0.27, 0.17], [0.35, 0.13], [0.45, 0.15], [0.55, 0.12], [0.61, 0.16]] },
  { name: "Стена Сарти", h: 0.78, w: 0.022, pts: [[0.29, 0.28], [0.37, 0.255], [0.46, 0.265], [0.54, 0.29]] },
  { name: "Восточные горы", h: 0.85, w: 0.024, pts: [[0.585, 0.31], [0.645, 0.36], [0.685, 0.44], [0.70, 0.50]] },
  { name: "Хинкские горы", h: 0.72, w: 0.024, pts: [[0.335, 0.555], [0.41, 0.525], [0.49, 0.55], [0.565, 0.515]] },
  { name: "Унюанский кряж", h: 0.62, w: 0.022, pts: [[0.205, 0.50], [0.235, 0.585], [0.215, 0.685]] },
  { name: "Эдукский хребет", h: 0.74, w: 0.016, pts: [[0.055, 0.075], [0.105, 0.125], [0.15, 0.195]] },
  { name: "Пик Моа-Ноа", h: 1.0, w: 0.020, pts: [[0.040, 0.565], [0.045, 0.595]] },
  { name: "Зубцы Силы", h: 0.6, w: 0.012, pts: [[0.795, 0.715], [0.845, 0.755], [0.895, 0.845]] }
];

// FMG reads a heightmap pixel as lightness, then bends it: h = (0.2 + (l - 0.2)^0.8) * 100.
// Encode with the inverse so the elevation we sculpt is the elevation the generator sees.
const encodeHeight = H => {
  if (H < 20) return Math.max(0, Math.min(50, Math.round((H / 100) * 255)));
  const l = 0.2 + (H / 100 - 0.2) ** 1.25;
  return Math.max(51, Math.min(255, Math.round(l * 255)));
};

const distToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

const jpeg = readFileSync("tools/assets/rodmur-source.jpg");
const { heights, regions, stats } = await withBrowser(async browser => {
  const page = await browser.newPage();
  const img = await decodeImage(page, jpeg.toString("base64"), "image/jpeg");
  const rgba = Buffer.from(img.b64, "base64");
  const w = img.w;
  const h = img.h;

  const ids = classify(rgba, w, h);
  const land = landMask(ids, w, h);
  const inland = distanceField(land, w, h, 1);
  const offshore = distanceField(land, w, h, 0);
  const fbm = makeNoise(20261114);
  const ridgeNoise = makeNoise(777);

  const heights = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const fx = x / w;
      const fy = y / h;
      if (!land[p]) {
        const d = offshore[p];
        heights[p] = encodeHeight(Math.max(2, 18 - Math.min(16, d * 0.55)));
        continue;
      }
      const d = inland[p];
      const coastRamp = Math.min(1, d / 9);
      let v = 24 + coastRamp * (7 + 9 * (fbm(fx * 9, fy * 9, 4) * 0.5 + 0.5));

      for (const r of RIDGES) {
        let dist = Infinity;
        for (let i = 0; i < r.pts.length - 1; i++) {
          const [ax, ay] = r.pts[i];
          const [bx, by] = r.pts[i + 1];
          dist = Math.min(dist, distToSegment(fx, fy, ax, ay, bx, by));
        }
        if (dist > r.w * 3) continue;
        const wobble = 1 + 0.35 * ridgeNoise(fx * 26, fy * 26, 3);
        const falloff = Math.exp(-((dist / (r.w * wobble)) ** 2));
        v += r.h * 62 * falloff * coastRamp;
      }
      v += 6 * fbm(fx * 22, fy * 22, 5) * coastRamp;
      heights[p] = encodeHeight(Math.max(22, Math.min(99, v)));
    }
  }

  // region masks: painted colour, grown over the coast outline the same way land was
  const regions = REGIONS.map((r, idx) => {
    let raw = new Uint8Array(w * h);
    for (let p = 0; p < raw.length; p++) if (ids[p] === idx + 3) raw[p] = 1;
    raw = fillHoles(dropSpecks(openMask(raw, w, h), w, h, 120), w, h);
    const contours = traceContours(raw, w, h, 120);
    return {
      key: r.key,
      rgb: r.rgb,
      pixels: raw.reduce((a, b) => a + b, 0),
      rings: contours.map(c => {
        const simplified = simplify(c.ring, 1.6);
        const smoothed = smoothRing(simplified, 2);
        return { area: c.area, points: smoothed.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]) };
      })
    };
  });

  // hand the heights back as a PNG through the canvas encoder
  const png = await page.evaluate(
    ({ hs, w, h }) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      const im = ctx.createImageData(w, h);
      const arr = Uint8Array.from(atob(hs), ch => ch.charCodeAt(0));
      for (let p = 0; p < w * h; p++) {
        im.data[p * 4] = im.data[p * 4 + 1] = im.data[p * 4 + 2] = arr[p];
        im.data[p * 4 + 3] = 255;
      }
      ctx.putImageData(im, 0, 0);
      return c.toDataURL("image/png").split(",")[1];
    },
    { hs: Buffer.from(heights).toString("base64"), w, h }
  );

  const stats = {
    size: [w, h],
    landPixels: land.reduce((a, b) => a + b, 0),
    regions: regions.map(r => ({ key: r.key, pixels: r.pixels, rings: r.rings.length }))
  };
  return { heights: png, regions, stats };
});

writeFileSync("tools/assets/rodmur-heightmap.png", Buffer.from(heights, "base64"));
writeFileSync("tools/geography/regions.json", JSON.stringify({ size: [SRC_W, SRC_H], regions }, null, 1));
console.log(JSON.stringify(stats, null, 1));
console.log("heightmap -> tools/assets/rodmur-heightmap.png");
console.log("region outlines ->", "tools/geography/regions.json");
console.log("rings:", regions.map(r => `${r.key}[${r.rings.map(x => x.area).join(" ")}]`).join(" "));
