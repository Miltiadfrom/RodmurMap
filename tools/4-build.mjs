// Step 4 — assemble the atlas: country shapes, snapped settlements, named rivers, roads.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { pointInRing } from "./lib.mjs";
import { scopeCss } from "./css-scope.mjs";
import { COUNTRIES, CITIES, RIVERS, RANGES, SEAS, ROADS, ERA, INTRO } from "./content/rodmur.mjs";

const MAP_W = 1600;
const MAP_H = 900;
const KM_PER_PX = 2.5;
const RURAL_FACTOR = 4;

const regions = JSON.parse(readFileSync("tools/geography/regions.json", "utf8"));
const geo = JSON.parse(readFileSync("tools/geography/fmg-geography.json", "utf8"));
const scale = MAP_W / regions.size[0];

const ringArea = ring => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a / 2);
};
const toPath = ring => `M${ring.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}Z`;

const shapes = {};
for (const r of regions.regions) {
  const rings = r.rings.map(x => x.points.map(([x, y]) => [x * scale, y * scale]));
  const bbox = rings.flat().reduce(
    (b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)],
    [Infinity, Infinity, -Infinity, -Infinity]
  );
  shapes[r.key] = {
    rings,
    paths: rings.map(toPath),
    area: rings.reduce((a, ring) => a + ringArea(ring), 0),
    bbox
  };
}

const inside = (key, x, y) => shapes[key].rings.some(ring => pointInRing(x, y, ring));
const riverName = new Map();
for (const r of RIVERS) {
  const found = geo.rivers.find(g => g.name === r.fmg);
  if (found) riverName.set(found.i, r.id);
}

// ── settlements: snap the authored wish to the best real cell of the right land ──
const placed = [];
const snap = city => {
  const [wx, wy] = city.at;
  const pool = geo.landCells.filter(c => inside(city.country, c.x, c.y));
  const candidates = (pool.length ? pool : geo.landCells).filter(c => Math.hypot(c.x - wx, c.y - wy) < 110);
  const score = c => {
    let s = -Math.hypot(c.x - wx, c.y - wy);
    if (city.prefer === "river" && c.r) s += 55;
    if (city.prefer === "coast" && c.coast) s += 55;
    if (city.prefer === "coast" && !c.coast) s -= 25;
    s += (c.suit || 0) * 0.35;
    if (c.h > 68) s -= (c.h - 68) * 3;
    if (placed.some(p => Math.hypot(p.x - c.x, p.y - c.y) < 20)) s -= 400;
    return s;
  };
  const best = (candidates.length ? candidates : pool).sort((a, b) => score(b) - score(a))[0];
  return best ?? { x: wx, y: wy, h: 30, r: 0, coast: 0 };
};

const cities = CITIES.map(c => {
  const cell = snap(c);
  const city = {
    id: c.id,
    country: c.country,
    name: c.name,
    kind: c.kind,
    x: +cell.x.toFixed(1),
    y: +cell.y.toFixed(1),
    population: c.population,
    founded: c.founded,
    ruler: c.ruler,
    summary: c.summary,
    description: c.description,
    notables: c.notables ?? [],
    port: !!cell.coast,
    river: riverName.get(cell.r) ?? null,
    elevation: Math.round((cell.h - 20) * 45)
  };
  placed.push(city);
  return city;
});

const countries = COUNTRIES.map(c => {
  const own = cities.filter(x => x.country === c.id);
  const urban = own.reduce((a, x) => a + x.population, 0);
  const capital = own.find(x => x.kind === "capital") ?? own[0];
  const shape = shapes[c.id];
  return {
    id: c.id,
    name: c.name,
    fullName: c.fullName,
    color: c.color,
    terrain: c.terrain || "",
    government: c.government,
    ruler: c.ruler,
    motto: c.motto,
    summary: c.summary,
    description: c.description,
    history: c.history,
    economy: c.economy,
    military: c.military,
    capital: capital?.id ?? null,
    population: Math.round(urban * RURAL_FACTOR),
    area: Math.round(shape.area * KM_PER_PX * KM_PER_PX),
    label: c.label,
    paths: shape.paths,
    bbox: shape.bbox.map(n => +n.toFixed(1))
  };
});

const rivers = RIVERS.map(r => {
  const g = geo.rivers.find(x => x.name === r.fmg);
  if (!g) return null;
  return {
    id: r.id,
    name: r.name,
    length: Math.round(g.length * KM_PER_PX),
    x: g.mid?.[0] ?? g.mouth?.[0] ?? 0,
    y: g.mid?.[1] ?? g.mouth?.[1] ?? 0,
    rotate: r.label.rotate ?? 0
  };
}).filter(Boolean);

const byId = new Map(cities.map(c => [c.id, c]));
const roads = ROADS.map((r, i) => {
  const a = byId.get(r.from);
  const b = byId.get(r.to);
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = (r.kind === "sea" ? 0.16 : 0.07) * (i % 2 ? 1 : -1);
  const cx = (a.x + b.x) / 2 - dy * bend;
  const cy = (a.y + b.y) / 2 + dx * bend;
  return {
    id: `${r.from}--${r.to}`,
    name: r.name ?? "",
    kind: r.kind,
    from: r.from,
    to: r.to,
    length: Math.round(len * KM_PER_PX),
    path: `M${a.x},${a.y} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x},${b.y}`
  };
}).filter(Boolean);

const world = {
  meta: {
    title: "Повесть о Родмуре",
    subtitle: "Атлас мира",
    era: ERA,
    intro: INTRO,
    map: { width: MAP_W, height: MAP_H, file: "map/rodmur-base.svg", kmPerPx: KM_PER_PX },
    generator: { tool: "Azgaar Fantasy Map Generator", version: geo.version, seed: geo.seed, cells: geo.cellsCount },
    revision: 1,
    updatedAt: new Date().toISOString()
  },
  countries,
  cities,
  rivers,
  ranges: RANGES,
  seas: SEAS,
  roads
};

// ── slim the base map: drop unused defs, round coordinates ──────────────────
const dropElement = (svg, id) => {
  const open = svg.indexOf(`<g id="${id}"`);
  if (open < 0) return svg;
  let i = svg.indexOf(">", open) + 1;
  let depth = 1;
  while (i < svg.length && depth > 0) {
    const nextOpen = svg.indexOf("<g", i);
    const nextClose = svg.indexOf("</g>", i);
    if (nextClose < 0) break;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + 2;
    } else {
      depth--;
      i = nextClose + 4;
    }
  }
  return svg.slice(0, open) + svg.slice(i);
};

const roundAttrs = (svg, precision, ids) => {
  for (const id of ids) {
    const start = svg.indexOf(`<g id="${id}"`);
    if (start < 0) continue;
    const end = svg.indexOf("</g>", start);
    if (end < 0) continue;
    const chunk = svg
      .slice(start, end)
      .replace(/\s(d|points)="([^"]*)"/g, (_, attr, value) => ` ${attr}="${value.replace(/-?\d+\.\d+/g, n => (+n).toFixed(precision))}"`);
    svg = svg.slice(0, start) + chunk + svg.slice(end);
  }
  return svg;
};

let baseSvg = readFileSync("tools/geography/fmg-base.svg", "utf8");
// Корень сериализованной карты может нести повторные xmlns — строгий XML-разбор такое отвергает.
baseSvg = baseSvg.replace(/^<svg\b([^>]*)>/, (_, attrs) => {
  const seen = new Set();
  const kept = [];
  for (const [, name, value] of attrs.matchAll(/([:\w-]+)="([^"]*)"/g)) {
    if (seen.has(name)) continue;
    seen.add(name);
    kept.push(`${name}="${value}"`);
  }
  return `<svg ${kept.join(" ")}>`;
});
baseSvg = dropElement(baseSvg, "gridPatterns");
baseSvg = roundAttrs(baseSvg, 0, ["biomes", "oceanWaves"]);
baseSvg = roundAttrs(baseSvg, 1, ["rivers", "featurePaths", "terrain", "lakes", "coastline"]);
// Внутри CSS встречаются «<» (например, @media (width <= 600px)) — в XML это допустимо только в CDATA.
baseSvg = baseSvg.replace(/<style>([\s\S]*?)<\/style>/, (_, css) => {
  const scoped = scopeCss(css.replace(/^<!\[CDATA\[|\]\]>$/g, ""), "#fmg-base").replace(/\]\]>/g, "]]&gt;");
  return `<style><![CDATA[${scoped}]]></style>`;
});
baseSvg = baseSvg.replace(/<(style|defs)>\s*<\/\1>/g, "");
// Бумажная текстура лежит рядом с картой, а не в сборке генератора.
baseSvg = baseSvg
  .replace(/href="\.\/images\/textures\/antique-small\.jpg"/g, 'href="map/antique-small.jpg"')
  .replace(/href="\.\/images\/pattern2\.png"/g, 'href="map/pattern2.png"');
copyFileSync("tools/assets/antique-small.jpg", "client/map/antique-small.jpg");
copyFileSync("tools/assets/pattern2.png", "client/map/pattern2.png");

mkdirSync("data", { recursive: true });
mkdirSync("client/map", { recursive: true });
writeFileSync("data/world.json", JSON.stringify(world, null, 1));
writeFileSync("client/map/rodmur-base.svg", baseSvg);

const offLand = cities.filter(c => !inside(c.country, c.x, c.y));
console.log(`base map ${(baseSvg.length / 1048576).toFixed(2)} MB`);
console.log(`countries ${countries.length}, cities ${cities.length}, rivers ${rivers.length}, roads ${roads.length}`);
console.log("off-land cities:", offLand.map(c => c.id).join(", ") || "none");
console.log(
  countries.map(c => `${c.name}: ${c.area.toLocaleString("ru-RU")} км², ${(c.population / 1000).toFixed(0)} тыс. чел., ${cities.filter(x => x.country === c.id).length} городов`).join("\n")
);
