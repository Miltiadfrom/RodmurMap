// Step 2 — run the Fantasy Map Generator on the rebuilt Rodmur heightmap and harvest
// the physical world: a styled base map plus the raw geography we hang our own atlas on.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { withBrowser } from "./lib.mjs";
import { ensureFmg, serveDist } from "./fmg.mjs";

const fmg = ensureFmg();
const host = process.env.FMG_URL ? null : await serveDist(fmg.dist);
const FMG_URL = process.env.FMG_URL || host.url;
const SEED = process.env.RODMUR_SEED || "rodmur-tale-1";
const WIDTH = +(process.env.RODMUR_WIDTH || 1600);
const HEIGHT = +(process.env.RODMUR_HEIGHT || 900);
const DENSITY = +(process.env.RODMUR_DENSITY || 5); // 5 = 20 000 точек; 6 ≈ 30 000 (см. graph-density в FMG)
const PRESET = process.env.RODMUR_STYLE || "ancient";
// Облик подложки. Живая панель «Оформление» в атласе умеет то же самое без пересборки,
// но эти значения задают, что посетитель увидит по умолчанию.
const RELIEF_SET = process.env.RODMUR_RELIEF_SET || "illustrated"; // illustrated | simple
const RELIEF_SIZE = +(process.env.RODMUR_RELIEF_SIZE || 1.15);     // крупность знаков
const RELIEF_DENSITY = +(process.env.RODMUR_RELIEF_DENSITY || 0.2); // густота россыпи
const RELIEF_STROKE = process.env.RODMUR_RELIEF_STROKE || "#5b4630";
const OUT = "tools/out";
mkdirSync(OUT, { recursive: true });
mkdirSync("tools/geography", { recursive: true });

const heightmaps = join(process.env.FMG_DIST || fmg.dist, "heightmaps");
mkdirSync(heightmaps, { recursive: true });
copyFileSync("tools/assets/rodmur-heightmap.png", join(heightmaps, "rodmur.png"));

const KEEP_LAYERS = ["ocean", "landmass", "texture", "lakes", "biomes", "rivers", "relief", "coastline", "ice"];

const result = await withBrowser(async browser => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route("**://www.googletagmanager.com/**", r => r.abort());
  await page.route("**://*.google-analytics.com/**", r => r.abort());
  page.on("pageerror", e => console.error("[page]", (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
  page.on("console", m => {
    const t = m.text();
    if (m.type() === "error" || t.startsWith("[step]") || t.startsWith("[gen]")) console.log("[browser]", t.slice(0, 400));
  });

  await page.goto(FMG_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.FMG?.mapHistory?.length > 0, null, { timeout: 240000 });
  console.log("booted, generating Rodmur…");

  await page.evaluate(
    async ({ seed, width, height, density, preset, keep, relief }) => {
      FMG.log.enabled.time = false;
      FMG.Dialog.closeAll();

      // The atlas supplies its own political layer, so the generator only has to build the
      // physical world. Trimming the pipeline keeps routes/markets/armies out of memory.
      const physicalSteps = new Set([
        "grid", "heightmap", "markupGrid", "depressionLakes", "nearSeaLakes", "mapSize",
        "temperatures", "precipitation", "clearPack", "clearGraphOverride", "regraph",
        "markupPack", "rivers", "biomes", "featureGroups", "ice", "rankCells",
        "cultures", "culturesExpand", "burgs", "states", "routes", "religions", "burgsSpecify", "provinces", "provincePoles", "riversSpecify", "featureNames"
      ]);
      FMG.GenerationPipeline.steps = FMG.GenerationPipeline.steps
        .filter(s => physicalSteps.has(s.id))
        .map(s => ({ id: s.id, run: async ctx => { console.log("[step] " + s.id); await s.run(ctx); } }));
      FMG.Layers.set(keep);
      FMG.Pins.set("manors", 240);
      FMG.Pins.set("statesNumber", 9);
      FMG.Pins.set("provincesRatio", 0);
      FMG.Pins.set("religionsNumber", 3);
      FMG.Pins.set("template", "rodmur");
      FMG.Pins.set("points", density);
      FMG.Pins.set("mapWidth", width);
      FMG.Pins.set("mapHeight", height);
      FMG.options.generation.template = "rodmur";
      FMG.options.generation.graph.density = density;
      FMG.options.map.style.preset = preset;
      await FMG.Controllers.StylePresetsEditor.applyOnLoad();

      const done = new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error("generation timed out")), 200000);
        addEventListener("map:generated", () => { clearTimeout(timer); res(); }, { once: true });
      });
      FMG.regenerateMap({ seed, width, height });
      await done;
      console.log("[gen] done");
      FMG.Dialog.closeAll();

      // Art direction: fewer, larger engraved relief icons, ink-blue rivers, a whisper of biome.
      FMG.styles.relief.options.set = relief.set;
      FMG.styles.relief.options.size = relief.size;
      FMG.styles.relief.options.density = relief.density;
      FMG.styles.relief.attrs.stroke = relief.stroke;
      FMG.styles.rivers.attrs.fill = "#7d95a3";
      FMG.styles.lakes.groups.freshwater.attrs.fill = "#c3d2da";
      FMG.Styles.writeAll();
      for (const id of keep) {
        try {
          FMG.Layers.draw(id);
        } catch (e) {
          console.log("[gen] layer " + id + " failed: " + e.message);
        }
      }
    },
    {
      seed: SEED, width: WIDTH, height: HEIGHT, density: DENSITY, preset: PRESET, keep: KEEP_LAYERS,
      relief: { set: RELIEF_SET, size: RELIEF_SIZE, density: RELIEF_DENSITY, stroke: RELIEF_STROKE }
    }
  );
  await page.waitForTimeout(2500);

  const data = await page.evaluate(() => {
    const { cells, burgs, rivers, features } = FMG.pack;
    console.log("[gen] pack keys: " + Object.keys(FMG.pack).join(",") + " | rivers=" + typeof rivers + " features=" + typeof features + " burgs=" + typeof burgs);
    const round = (n, p = 1) => +n.toFixed(p);
    const riverMid = r => {
      const cs = r.cells || [];
      const c = cs[Math.floor(cs.length / 2)] ?? r.source;
      return cells.p[c] ? [round(cells.p[c][0]), round(cells.p[c][1])] : null;
    };
    return {
      seed: FMG.options.map.seed,
      version: FMG.VERSION,
      size: [FMG.options.map.graph.width, FMG.options.map.graph.height],
      graphOptions: JSON.parse(JSON.stringify(FMG.options.generation.graph)),
      mapGraph: JSON.parse(JSON.stringify(FMG.options.map.graph)),
      template: FMG.options.generation.template,
      cellsCount: cells.i.length,
      landCells: cells.i.filter(i => cells.h[i] >= 20).length,
      burgs: burgs
        .filter(b => b && !b.removed)
        .map(b => ({
          i: b.i,
          name: b.name,
          x: round(b.x),
          y: round(b.y),
          cell: b.cell,
          population: round(b.population ?? 0, 2),
          port: !!b.port,
          capital: !!b.capital,
          river: cells.r[b.cell] || 0,
          height: cells.h[b.cell] ?? 0,
          biome: cells.biome[b.cell] ?? 0,
          culture: b.culture
        })),
      rivers: rivers
        .filter(r => r && !r.removed)
        .map(r => ({
          i: r.i,
          name: r.name,
          type: r.type,
          length: round(r.length ?? 0, 1),
          discharge: r.discharge ?? 0,
          width: r.width ?? 0,
          source: cells.p[r.source] ? [round(cells.p[r.source][0]), round(cells.p[r.source][1])] : null,
          mouth: cells.p[r.mouth] ? [round(cells.p[r.mouth][0]), round(cells.p[r.mouth][1])] : null,
          mid: riverMid(r)
        })),
      landCells: Array.from(cells.i)
        .filter(i => cells.h[i] >= 20)
        .map(i => ({
          i,
          x: round(cells.p[i][0]),
          y: round(cells.p[i][1]),
          h: cells.h[i],
          r: cells.r[i] || 0,
          coast: cells.t[i] === 1 ? 1 : 0,
          haven: cells.haven[i] || 0,
          pop: round(cells.pop[i] ?? 0, 2),
          suit: round(cells.s[i] ?? 0, 2),
          biome: cells.biome[i]
        })),
      lakes: features
        .filter(f => f && f.type === "lake" && !f.removed)
        .map(f => ({ i: f.i, name: f.name, cells: f.cells, shoreline: f.shoreline }))
        .slice(0, 40),
      features: features
        .filter(f => f && !f.removed)
        .map(f => ({ i: f.i, type: f.type, name: f.name, group: f.group, cells: f.cells }))
        .slice(0, 60)
    };
  });

  // Serialise the live map instead of FMG's full export: the exporter walks every element's
  // computed style, which does not fit in this container's memory budget.
  const svg = await page.evaluate(keep => {
    const svgEl = document.getElementById("map");
    FMG.ViewportLayers.renderTo(svgEl);
    const biomes = svgEl.querySelector("#biomes");
    if (biomes) biomes.style.opacity = "0.22";
    const known = FMG.Layers.all.map(l => l.id);
    for (const g of [...svgEl.querySelectorAll("g[id]")]) {
      if (known.includes(g.id) && !keep.includes(g.id)) g.remove();
    }
    const ser = new XMLSerializer();
    const css = [...document.styleSheets]
      .map(sheet => {
        try {
          return [...sheet.cssRules].map(r => r.cssText).join("\n");
        } catch {
          return "";
        }
      })
      .join("\n");
    return {
      map: ser.serializeToString(svgEl),
      defs: ser.serializeToString(document.getElementById("defElements").querySelector("defs")),
      css
    };
  }, KEEP_LAYERS);

  return { data, svg };
});

writeFileSync("tools/geography/fmg-geography.json", JSON.stringify(result.data, null, 1));
const raw = result.svg;
const open = raw.map.slice(0, raw.map.indexOf(">") + 1);
const body = raw.map.slice(raw.map.indexOf(">") + 1);
const sized = open
  .replace(/\swidth="[^"]*"/, "")
  .replace(/\sheight="[^"]*"/, "")
  .replace(/\sviewBox="[^"]*"/, "")
  .replace(/\sstyle="[^"]*"/, "")
  .replace(/<svg\b([^>]*)>/, (_, attrs) => {
    const seen = new Set([...attrs.matchAll(/([:\w-]+)="/g)].map(m => m[1]));
    const extra = [
      ["xmlns", "http://www.w3.org/2000/svg"],
      ["xmlns:xlink", "http://www.w3.org/1999/xlink"],
      ["width", String(WIDTH)],
      ["height", String(HEIGHT)],
      ["viewBox", `0 0 ${WIDTH} ${HEIGHT}`]
    ].filter(([name]) => !seen.has(name)).map(([name, value]) => ` ${name}="${value}"`).join("");
    return `<svg${attrs}${extra}>`;
  });
const assembled = `${sized}<style>${raw.css}</style>${raw.defs}${body.replace(/<g id="viewbox"[^>]*>/, '<g id="viewbox">')}`;
writeFileSync("tools/geography/fmg-base.svg", assembled);
console.log(
  `cells ${result.data.cellsCount} (land ${result.data.landCells.length}), burgs ${result.data.burgs.length}, rivers ${result.data.rivers.length}, svg ${(result.svg.map.length / 1024 / 1024).toFixed(2)} MB`
);

await host?.close();
