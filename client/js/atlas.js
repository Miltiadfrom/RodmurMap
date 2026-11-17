import { svgEl, shade, esc, KINDS, TERRAINS, people } from "./util.js";
import { smoothPath, riverPath, scatterInside, polygonCenter, polygonBounds, pointInPolygon, alongPath, rng } from "./geometry.js";

/* Природа земли. Подложка нарисована один раз, но биомы в ней — отдельные пути,
   а растительность — отдельные знаки. Поэтому землю можно переодевать на лету:
   внутри её контура перекрашиваем пятна биомов и меняем породу знаков. */
const TERRAIN_BIOMES = {
  meadow:  { 1: "#c6da7e", 2: "#c0d678", 3: "#bcd473", 4: "#b2d06c", 6: "#8bbd63", 8: "#7cb558", 9: "#72ab52", 10: "#aec97c", 12: "#75b060" },
  steppe:  { 1: "#e3d79a", 2: "#ddd294", 3: "#d8cf8c", 4: "#d3cc86", 6: "#bdbf78", 8: "#b2b76f", 9: "#a8ae68", 10: "#cdc489", 12: "#adb570" },
  savanna: { 1: "#e8d79c", 2: "#e0d296", 3: "#dbcd8e", 4: "#d5c987", 6: "#c3c07a", 8: "#b9b972", 9: "#aead66", 10: "#d2c584", 12: "#b5b26c" },
  forest:  { 1: "#8fbf6d", 2: "#86b966", 3: "#7fb261", 4: "#79ad5c", 6: "#5f9c4c", 8: "#559347", 9: "#4b8a41", 10: "#84b566", 12: "#3f7d3a" },
  jungle:  { 1: "#5fae55", 2: "#57a74f", 3: "#4fa049", 4: "#489a44", 6: "#2f8c39", 8: "#268332", 9: "#1f7a2d", 10: "#54a04a", 12: "#166b25" },
  desert:  { 1: "#fbe79f", 2: "#f2df9c", 3: "#ecd996", 4: "#e6d492", 6: "#d9cd8c", 8: "#d3c787", 9: "#cbc082", 10: "#e0d08d", 12: "#d0c485" },
  tundra:  { 1: "#dfe0d2", 2: "#d8dbcd", 3: "#d2d6c7", 4: "#ccd1c2", 6: "#b9c2ae", 8: "#b0baa7", 9: "#a7b2a0", 10: "#c6cbbc", 12: "#adb8a4" },
  swamp:   { 1: "#a9b98c", 2: "#a3b487", 3: "#9cb081", 4: "#96ab7c", 6: "#7d9a6a", 8: "#749263", 9: "#6b8a5d", 10: "#9aa982", 12: "#5f7f54" }
};

/* Порода знаков внутри земли: горы, холмы и вулканы не трогаем никогда. */
const TERRAIN_PLANTS = {
  meadow:  { dune: ["grass", "grass", "deciduous"], cactus: ["grass", "deciduous"], acacia: ["deciduous", "grass"], deadTree: ["deciduous", "grass"], palm: ["deciduous"], conifer: ["deciduous", "grass"], swamp: ["grass"] },
  steppe:  { dune: ["grass"], cactus: ["grass"], acacia: ["grass"], deadTree: ["grass"], palm: ["grass"], conifer: ["grass"], deciduous: ["grass", "grass", "deciduous"], swamp: ["grass"] },
  savanna: { dune: ["grass", "acacia"], cactus: ["acacia", "grass"], deadTree: ["acacia"], palm: ["acacia"], conifer: ["acacia", "grass"], deciduous: ["acacia", "grass"], swamp: ["grass"] },
  forest:  { dune: ["deciduous", "conifer"], cactus: ["deciduous"], acacia: ["deciduous"], palm: ["deciduous"], deadTree: ["deciduous"], grass: ["deciduous", "conifer", "grass"], swamp: ["conifer"] },
  jungle:  { dune: ["palm", "deciduous"], cactus: ["palm"], acacia: ["palm", "deciduous"], deadTree: ["deciduous"], conifer: ["deciduous"], grass: ["deciduous", "palm", "grass"], swamp: ["deciduous"] },
  desert:  { grass: ["dune", "grass", "cactus"], deciduous: ["acacia", "deadTree"], conifer: ["deadTree", "dune"], swamp: ["dune"], deadTree: ["deadTree"] },
  tundra:  { dune: ["grass"], cactus: ["grass"], acacia: ["grass"], palm: ["grass"], deciduous: ["grass", "deadTree"], conifer: ["coniferSnow", "grass"], swamp: ["grass"] },
  swamp:   { dune: ["swamp"], cactus: ["swamp"], acacia: ["swamp"], palm: ["swamp"], grass: ["swamp", "grass", "swamp"], deciduous: ["swamp", "deadTree"], conifer: ["swamp"] }
};

const GLYPHS = {
  capital: '<circle class="glyph" r="5.4"/><circle r="2.1" fill="#2b2318"/>',
  city: '<circle class="glyph" r="4.2"/>',
  town: '<circle class="glyph" r="3"/>',
  port: '<circle class="glyph" r="3.6"/><path class="glyph" d="M-5.4 4.6h10.8" fill="none"/>',
  fortress: '<rect class="glyph" x="-4.2" y="-3.4" width="8.4" height="7.6"/><path class="glyph" d="M-4.2 -3.4v-2.2h2.1v1.1h2.1v-1.1h2.1v1.1h2.1v-2.2" fill="none"/>',
  oasis: '<path class="glyph" d="M0 -5L5 0L0 5L-5 0Z"/>',
  shrine: '<path class="glyph" d="M0 -5.2L4.6 3.4H-4.6Z"/>'
};

const MARKER_GLYPHS = {
  battle: '<path class="marker-ink" d="M-4.5 -4.5L4.5 4.5M4.5 -4.5L-4.5 4.5"/>',
  ruin: '<path class="marker-ink" d="M-5 4.5V-1l2.5-2 2.5 2v5.5M0 4.5V-3l2.5-2 2.5 2v7.5"/>',
  mine: '<path class="marker-ink" d="M-5 4.5L0 -4l5 8.5zM-2.2 4.5v-3h4.4v3"/>',
  temple: '<path class="marker-ink" d="M-5.5 -1.5L0 -5.5l5.5 4M-4 -1.5v6M0 -1.5v6M4 -1.5v6M-5.5 4.5h11"/>',
  tower: '<path class="marker-ink" d="M-3 4.5V-3h6v7.5M-3 -3v-2h1.6v1.2h1.4V-5h1.4v1.2H3V-5h1.6v2"/>',
  anchor: '<path class="marker-ink" d="M0 -4.5v9M-3.5 -2h7M-4.5 1.5c0 3 2 3.5 4.5 3.5s4.5-.5 4.5-3.5"/>',
  star: '<path class="marker-ink" d="M0 -5.5l1.7 3.9 4.3.4-3.2 2.8 1 4.2L0 3.6l-3.8 2.2 1-4.2-3.2-2.8 4.3-.4z"/>',
  skull: '<path class="marker-ink" d="M-4 -1.5a4 4 0 018 0v3l-1.5 1v2h-5v-2L-4 1.5zM-1.8 -1.2v1.4M1.8 -1.2v1.4"/>'
};

const segmentDistance = (x, y, a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len)) : 0;
  return Math.hypot(x - (a[0] + dx * t), y - (a[1] + dy * t));
};

export class Atlas {
  constructor(svg, handlers = {}) {
    this.svg = svg;
    this.handlers = handlers;
    this.view = { x: 0, y: 0, k: 1 };
    this.limits = { min: 0.35, max: 14 };
    this.scaled = [];
    this.pointers = new Map();
    this.suppressClick = false;
    this.layers = {};
    this.tint = 22;
    this.world = null;
    this.selected = null;
    this.matches = null;
    this.admin = false;
    this.placing = false;
    this.predicate = null;
    this.peek = null;
    this.reliefItems = [];
    this.reliefApplied = null;
    this.cityById = new Map();
    this.editor = null;          // подключается хранителем: редактор карты
    this.paintItems = [];        // нарисованные знаки, для крупной перерисовки
    this.paintScaled = [];       // подписи правок с контрмасштабом
    this.forestCache = new Map();
    this.featureIndex = [];
    this.reliefScale = 1;
    this.reliefInk = 1;
    this.hiddenKeys = new Set();
  }

  async init(baseUrl) {
    const { width, height } = this.size();
    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.viewport = svgEl("g", { id: "viewport" });
    this.svg.append(this.viewport);

    this.base = svgEl("g", { id: "fmg-base" });
    this.viewport.append(this.base);

    // Порядок слоёв: знаки рельефа ложатся под краски земель, вода и подписи — поверх.
    const groups = [
      "paintIcons", "lands", "borders", "paintForests", "paintLakes", "paintRivers",
      "grid", "roads", "seas", "ranges", "rivers", "paintLabels", "landLabels",
      "cities", "cityLabels", "paintMarkers", "draft", "pick", "brush", "frame"
    ];
    this.g = {};
    for (const id of groups) {
      this.g[id] = svgEl("g", { id: `ov-${id}` }); // префикс, чтобы не спорить с id оболочки и подложки
      this.viewport.append(this.g[id]);
    }
    this.g.lands.style.mixBlendMode = "multiply";
    this.g.paintForests.style.mixBlendMode = "multiply";
    for (const id of ["draft", "pick", "brush"]) this.g[id].style.pointerEvents = "none";

    const text = await fetch(baseUrl).then(r => {
      if (!r.ok) throw new Error("Не удалось загрузить карту");
      return r.text();
    });
    const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
    if (parsed.querySelector("parsererror")) throw new Error("Файл карты повреждён");
    for (const child of [...parsed.documentElement.childNodes]) {
      this.base.append(document.importNode(child, true));
    }
    this.collectRelief();
    this.collectBaseRivers();
    this.collectBiomes();
    this.bindEvents();
    this.fit(false);
  }

  size() {
    return { width: this.world?.meta.map.width || 1600, height: this.world?.meta.map.height || 900 };
  }

  setWorld(world) {
    const signature = world.countries.map(c => `${c.id}:${c.paths.join(" ").length}`).join("|");
    if (signature !== this.landSignature) {
      this.landSignature = signature;
      this.rings = null;
      for (const item of this.reliefItems) item.land = undefined;
    }
    this.world = world;
    this.cityById = new Map(world.cities.map(c => [c.id, c]));
    this.svg.setAttribute("viewBox", `0 0 ${world.meta.map.width} ${world.meta.map.height}`);
    this.render();
  }

  setAdmin(on) {
    this.admin = on;
    this.render();
  }

  setLayers(layers) {
    this.layers = layers;
    const show = (id, on) => {
      this.g[id].style.display = on ? "" : "none";
    };
    show("lands", layers.tint);
    show("borders", layers.tint);
    show("grid", layers.grid);
    show("roads", layers.roads);
    show("seas", layers.seas);
    show("ranges", layers.hydro);
    show("rivers", layers.hydro);
    show("landLabels", layers.landLabels);
    show("cities", layers.cities);
    show("cityLabels", layers.cityLabels);
    show("paintIcons", layers.hydro !== false);
    show("paintForests", layers.hydro !== false);
    show("paintLakes", layers.hydro !== false);
    show("paintRivers", layers.hydro !== false);
    show("paintLabels", layers.landLabels !== false);
    show("paintMarkers", layers.cities !== false);
    this.applyZoom();
  }

  setTint(value) {
    this.tint = value;
    for (const node of this.g.lands.children) node.setAttribute("fill-opacity", (value / 100).toFixed(2));
  }

  render() {
    const world = this.world;
    if (!world) return;
    this.scaled = [];
    this.paintScaled = [];
    for (const g of Object.values(this.g)) g.replaceChildren();
    this.renderFrame();
    this.renderGrid();
    this.renderLands();
    this.applyTerrain();
    this.renderRoads();
    this.renderHydro();
    this.renderCities();
    this.renderFeatures();
    this.setLayers(this.layers);
    this.setTint(this.tint);
    this.applySelection();
  }

  /** Знаки рельефа — единственная часть подложки, которую можно перенастроить на лету.
      Набор знаков меняется подменой самих символов (три десятка узлов вместо тысяч ссылок),
      густота — одним маленьким стилем, сила чернил — прозрачностью группы,
      а крупность — геометрией значка: CSS-масштаб уводит знак от его клетки. */
  collectRelief() {
    this.reliefGroup = this.base.querySelector("#terrain");
    this.reliefSymbols = new Map();
    this.reliefItems = [];
    this.reliefApplied = null;
    this.reliefBuckets = 20;

    for (const node of this.base.querySelectorAll("#icons-library symbol")) {
      this.reliefSymbols.set(node.id, {
        node,
        html: node.innerHTML,
        viewBox: node.getAttribute("viewBox"),
        stroke: node.getAttribute("stroke-width")
      });
    }
    if (!this.reliefGroup) return;

    const uses = [...this.reliefGroup.querySelectorAll("use")];
    const first = /^relief-([a-z]+)-/.exec((uses[0]?.getAttribute("href") || "").replace(/^#/, ""));
    this.reliefBaseSet = first?.[1] ?? "illustrated";
    this.reliefCurrentSet = this.reliefBaseSet;
    this.reliefSets = [...new Set([...this.reliefSymbols.keys()]
      .map(id => /^relief-([a-z]+)-/.exec(id)?.[1])
      .filter(Boolean))];

    uses.forEach((node, i) => {
      const lot = (((i * 1103515245 + 12345) >>> 7) % 1000) / 1000;
      const bucket = Math.min(this.reliefBuckets - 1, Math.floor(lot * this.reliefBuckets));
      node.classList.add(`lot-${bucket}`);
      const item = {
        node,
        lot,
        bucket,
        i,
        x: Number(node.getAttribute("x")) || 0,
        y: Number(node.getAttribute("y")) || 0,
        w: Number(node.getAttribute("width")) || 0,
        h: Number(node.getAttribute("height")) || 0
      };
      item.key = `${item.x.toFixed(1)},${item.y.toFixed(1)}`;
      const parts = /^relief-[a-z]+-(.+)-(\d+)$/.exec((node.getAttribute("href") || "").replace(/^#/, ""));
      item.baseType = parts?.[1] ?? "hill";
      item.type = item.baseType;
      item.variant = Number(parts?.[2] || 1);
      item.unit = item.w / (this.iconBox(item.baseType) || 20);
      item.cx = item.x + item.w / 2;
      item.by = item.y + item.h;
      this.reliefItems.push(item);
    });
    this.reliefByPoint = new Map(this.reliefItems.map(item => [item.key, item]));

    this.reliefStyle = document.createElement("style");
    this.reliefStyle.id = "relief-density";
    document.head.append(this.reliefStyle);
  }

  /** Биомы подложки: пятна пород и знаки растительности — материал для «природы земли». */
  collectBiomes() {
    this.biomeGroup = this.base.querySelector("#biomes");
    this.biomePaths = this.biomeGroup ? [...this.biomeGroup.querySelectorAll("path[id]")] : [];
    this.terrainSignature = null;
    if (!this.biomeGroup) return;
    this.terrainGroup = svgEl("g", { id: "terrain-lands" });
    this.terrainDefs = svgEl("defs");
    this.terrainGroup.append(this.terrainDefs);
    this.biomeGroup.append(this.terrainGroup);
  }

  /** Контуры земель, разобранные на кольца: по ним решаем, чей это знак и чьё пятно биома. */
  landRings() {
    if (this.rings) return this.rings;
    this.rings = (this.world?.countries || []).map(country => {
      const rings = country.paths.join(" ").split("M").slice(1)
        .map(chunk => [...chunk.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map(m => [+m[1], +m[2]]))
        .filter(ring => ring.length > 2);
      const all = rings.flat();
      const bounds = all.length ? polygonBounds(all) : { x: 0, y: 0, width: 0, height: 0 };
      return { id: country.id, rings, bounds };
    });
    return this.rings;
  }

  landAt(x, y) {
    for (const land of this.landRings()) {
      const b = land.bounds;
      if (x < b.x || y < b.y || x > b.x + b.width || y > b.y + b.height) continue;
      if (land.rings.some(ring => pointInPolygon(x, y, ring))) return land.id;
    }
    return null;
  }

  /** Природа земель: перекрашиваем биомы внутри контура и меняем породу знаков под ним.
      overrides — живой показ правки в форме земли, до записи на сервер. */
  applyTerrain(overrides = null) {
    if (!this.world) return;
    const kind = new Map(this.world.countries.map(c => [c.id, overrides?.get(c.id) ?? c.terrain ?? ""]));
    const signature = [...kind].map(([id, value]) => `${id}=${value}`).join("|");
    if (signature === this.terrainSignature) return;
    this.terrainSignature = signature;

    if (this.terrainGroup) {
      this.terrainDefs.replaceChildren();
      for (const node of [...this.terrainGroup.children]) {
        if (node !== this.terrainDefs) node.remove();
      }
      for (const country of this.world.countries) {
        const palette = TERRAIN_BIOMES[kind.get(country.id)];
        if (!palette) continue;
        const clipId = `terrain-clip-${country.id}`;
        const clip = svgEl("clipPath", { id: clipId, clipPathUnits: "userSpaceOnUse" });
        clip.append(svgEl("path", { d: country.paths.join(" "), "clip-rule": "evenodd" }));
        this.terrainDefs.append(clip);
        const group = svgEl("g", {
          "clip-path": `url(#${clipId})`,
          "data-terrain": country.id,
          "data-terrain-kind": kind.get(country.id)
        });
        for (const path of this.biomePaths) {
          const color = palette[/(\d+)$/.exec(path.id)?.[1]];
          if (!color) continue;
          const copy = path.cloneNode(false);
          copy.removeAttribute("id");
          if (copy.getAttribute("fill") && copy.getAttribute("fill") !== "none") copy.setAttribute("fill", color);
          if (copy.getAttribute("stroke") && copy.getAttribute("stroke") !== "none") copy.setAttribute("stroke", color);
          group.append(copy);
        }
        this.terrainGroup.append(group);
      }
    }

    const scale = this.reliefScale || 1;
    for (const item of this.reliefItems) {
      if (item.land === undefined) item.land = this.landAt(item.cx, item.by);
      const plants = TERRAIN_PLANTS[kind.get(item.land)];
      const swap = plants?.[item.baseType];
      const type = swap ? swap[item.i % swap.length] : item.baseType;
      if (type === item.type) continue;
      item.type = type;
      const box = this.iconBox(type) * item.unit;
      item.w = box;
      item.h = box;
      item.x = item.cx - box / 2;
      item.y = item.by - box;
      const symbol = this.reliefCounterpart(this.reliefCurrentSet || this.reliefBaseSet, type, item.variant);
      if (symbol) item.node.setAttribute("href", `#${symbol}`);
      const w = box * scale;
      const h = box * scale;
      item.node.setAttribute("width", w.toFixed(2));
      item.node.setAttribute("height", h.toFixed(2));
      item.node.setAttribute("x", (item.x + (box - w) / 2).toFixed(2));
      item.node.setAttribute("y", (item.y + box - h).toFixed(2));
    }
  }

  /** Реки подложки — отдельные пути: их можно стирать и возвращать по одной. */
  collectBaseRivers() {
    this.baseRivers = [];
    const group = this.base.querySelector("#rivers");
    if (!group) return;
    for (const node of group.querySelectorAll("path[id]")) {
      let length = 0;
      try {
        length = node.getTotalLength();
      } catch {
        continue;
      }
      if (!length) continue;
      const step = Math.max(6, length / 48);
      const points = [];
      for (let d = 0; d <= length; d += step) {
        const p = node.getPointAtLength(d);
        points.push([p.x, p.y]);
      }
      this.baseRivers.push({ id: node.id, node, points });
    }
  }

  baseRiversNear(x, y, radius) {
    return (this.baseRivers || []).filter(river =>
      river.points.some(p => Math.hypot(p[0] - x, p[1] - y) <= radius + 2));
  }

  reliefCounterpart(set, type, variant) {
    const exact = `relief-${set}-${type}-${variant}`;
    if (this.reliefSymbols.has(exact)) return exact;
    const first = `relief-${set}-${type}-1`;
    if (this.reliefSymbols.has(first)) return first;
    for (const id of this.reliefSymbols.keys()) {
      if (id.startsWith(`relief-${set}-${type}-`)) return id;
    }
    return null;
  }

  /** Подменяем содержимое символов, а не тысячи ссылок на них. */
  applyReliefSet(set) {
    if (set === this.reliefCurrentSet) return;
    const restore = set === this.reliefBaseSet;
    for (const [id, info] of this.reliefSymbols) {
      const parts = /^relief-([a-z]+)-(.+)-(\d+)$/.exec(id);
      if (!parts || parts[1] !== this.reliefBaseSet) continue;
      const source = restore ? info : this.reliefSymbols.get(this.reliefCounterpart(set, parts[2], parts[3]) || "");
      if (!source) continue;
      info.node.innerHTML = restore
        ? source.html
        : source.html.replace(/#fff\b|#ffffff\b/gi, "#f4ead7").replace(/#999\b|#999999\b/gi, "#c3b092");
      for (const [attr, value] of [["viewBox", source.viewBox], ["stroke-width", source.stroke]]) {
        if (value) info.node.setAttribute(attr, value);
        else info.node.removeAttribute(attr);
      }
    }
    this.reliefCurrentSet = set;
  }

  /** set — набор знаков, scale — крупность, density — густота, ink — сила чернил. */
  setRelief({ set, scale, density, ink }) {
    if (!this.reliefGroup || !this.reliefItems.length) return;
    const prev = this.reliefApplied || {};
    if (set !== prev.set) this.applyReliefSet(set);
    if (scale !== prev.scale) {
      // Крупность правим геометрией значка: CSS-масштаб уводит знак от его места.
      for (const item of this.reliefItems) {
        const w = item.w * scale;
        const h = item.h * scale;
        item.node.setAttribute("width", w.toFixed(2));
        item.node.setAttribute("height", h.toFixed(2));
        item.node.setAttribute("x", (item.x + (item.w - w) / 2).toFixed(2));
        item.node.setAttribute("y", (item.y + item.h - h).toFixed(2));
      }
    }
    if (density !== prev.density) {
      const cut = Math.ceil(density * this.reliefBuckets);
      const rules = [];
      for (let bucket = cut; bucket < this.reliefBuckets; bucket++) {
        rules.push(`#fmg-base #terrain use.lot-${bucket}{display:none}`);
      }
      this.reliefStyle.textContent = rules.join("");
    }
    if (ink !== prev.ink) this.reliefGroup.style.opacity = String(ink);
    this.reliefScale = scale;
    this.reliefInk = ink;
    this.applyPaintStyle();
    this.reliefGroup.dataset.reliefSet = set;
    this.reliefGroup.dataset.reliefDensity = String(density);
    this.reliefApplied = { set, scale, density, ink };
  }

  setBaseLayer(id, on) {
    const group = this.base.querySelector(`#${id}`);
    if (group) group.style.display = on ? "" : "none";
  }

  /** Живой показ правки земли: имя, цвет и подпись меняются на карте до сохранения. */
  previewCountry(id, patch = {}) {
    const country = this.world?.countries.find(c => c.id === id);
    if (!country) return;
    this.applyTerrain(patch.terrain !== undefined ? new Map([[id, patch.terrain]]) : null);
    const color = patch.color || country.color;
    const shape = this.g.lands.querySelector(`[data-country="${id}"]`);
    const border = this.g.borders.querySelector(`[data-country="${id}"]`);
    const labelNode = this.g.landLabels.querySelector(`[data-country-label="${id}"]`);
    if (shape) shape.setAttribute("fill", color);
    if (border) border.setAttribute("stroke", shade(color, -0.45));
    if (!labelNode) return;
    const label = { ...country.label, ...(patch.label || {}) };
    const text = labelNode.querySelector("text");
    labelNode.setAttribute("transform", `translate(${label.x},${label.y})`);
    text.textContent = patch.name ?? country.name;
    text.setAttribute("fill", shade(color, -0.55));
    text.setAttribute("font-size", ((label.size || 24) * 0.56).toFixed(1));
    text.setAttribute("transform", `rotate(${label.rotate || 0})`);
  }


  /* ── авторские правки карты: знаки, леса, реки, озёра, надписи, метки ── */

  features() {
    const f = this.world?.features || {};
    return {
      icons: f.icons || [], hidden: f.hidden || [], forests: f.forests || [],
      rivers: f.rivers || [], lakes: f.lakes || [], labels: f.labels || [], markers: f.markers || []
    };
  }

  renderFeatures() {
    const data = this.features();
    this.paintItems = [];
    this.paintScaled = [];
    this.featureIndex = [];
    for (const key of ["paintIcons", "paintForests", "paintLakes", "paintRivers", "paintLabels", "paintMarkers"]) {
      this.g[key].replaceChildren();
    }
    for (const forest of data.forests) this.renderForest(forest);
    for (const lake of data.lakes) this.renderLake(lake);
    for (const river of data.rivers) this.renderRiver(river);
    for (const icon of data.icons) this.renderIcon(icon);
    for (const label of data.labels) this.renderFeatureLabel(label);
    for (const marker of data.markers) this.renderMarker(marker);
    this.applyHidden(data.hidden);
    this.applyPaintStyle();
  }

  /** Знак рисуется ссылкой на символ подложки — стиль «гравюра/простые знаки» подхватывается сам. */
  iconSymbol(type, seed) {
    const variants = [...this.reliefSymbols.keys()].filter(id => id.startsWith(`relief-${this.reliefBaseSet}-${type}-`));
    if (!variants.length) return `relief-${this.reliefBaseSet}-hill-1`;
    const random = rng(seed);
    return variants[Math.floor(random() * variants.length) % variants.length];
  }

  iconBox(type) {
    if (type === "mount" || type === "mountSnow" || type === "vulcan") return 30;
    if (type === "hill" || type === "dune") return 23;
    if (type === "grass" || type === "swamp") return 16;
    return 20;
  }

  placeIcon(group, type, x, y, size, seed, ref) {
    const box = this.iconBox(type);
    const node = svgEl("use", {
      href: `#${this.iconSymbol(type, seed)}`,
      width: box,
      height: box,
      x: -box / 2,
      y: -box,
      transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`
    });
    if (ref) node.setAttribute("data-feature", ref);
    node.classList.add("paint-icon");
    group.append(node);
    this.paintItems.push({ node, box, x, y, size });
    return node;
  }

  renderIcon(icon) {
    const ref = `icons:${icon.id}`;
    this.placeIcon(this.g.paintIcons, icon.type, icon.x, icon.y, icon.size ?? 1, icon.id, ref);
    this.featureIndex.push({ layer: "icons", id: icon.id, x: icon.x, y: icon.y, r: this.iconBox(icon.type) * (icon.size ?? 1) * 0.45 });
  }

  renderForest(forest) {
    const ref = `forests:${forest.id}`;
    const group = svgEl("g", { "data-feature": ref, class: "paint-forest" });
    const path = svgEl("path", { class: `forest-wash ${forest.kind}`, d: smoothPath(forest.points, true) });
    group.append(path);
    const key = `${forest.id}:${forest.kind}:${forest.density}:${forest.points.length}:${forest.points[0]}`;
    let trees = this.forestCache.get(key);
    if (!trees) {
      const spacing = 26 / Math.max(0.2, forest.density || 1);
      trees = scatterInside(forest.points, spacing, forest.id, 700);
      this.forestCache.set(key, trees);
      if (this.forestCache.size > 400) this.forestCache.delete(this.forestCache.keys().next().value);
    }
    const kinds = {
      conifer: ["conifer"], coniferSnow: ["coniferSnow"], deciduous: ["deciduous"],
      mixed: ["conifer", "deciduous"], jungle: ["palm", "acacia"], swamp: ["swamp"], dead: ["deadTree"]
    };
    const pool = kinds[forest.kind] || kinds.mixed;
    for (const tree of trees) {
      const type = pool[Math.floor(tree.r * pool.length) % pool.length];
      this.placeIcon(group, type, tree.x, tree.y, 0.78 + tree.r * 0.32, `${forest.id}:${tree.x}`, null);
    }
    this.g.paintForests.append(group);
    if (forest.name) {
      const [cx, cy] = polygonCenter(forest.points);
      this.featureText(this.g.paintLabels, forest.name, cx, cy, "forest-label", 15, 0, ref);
    }
    this.featureIndex.push({ layer: "forests", id: forest.id, points: forest.points, ...polygonBounds(forest.points) });
  }

  renderLake(lake) {
    const ref = `lakes:${lake.id}`;
    const node = svgEl("path", {
      class: "paint-lake",
      "data-feature": ref,
      d: smoothPath(lake.points, true)
    });
    this.g.paintLakes.append(node);
    if (lake.name) {
      const [cx, cy] = polygonCenter(lake.points);
      this.featureText(this.g.paintLabels, lake.name, cx, cy, "river-label", 14, 0, ref);
    }
    this.featureIndex.push({ layer: "lakes", id: lake.id, points: lake.points, ...polygonBounds(lake.points) });
  }

  renderRiver(river) {
    const ref = `rivers:${river.id}`;
    const node = svgEl("path", {
      class: "paint-river",
      "data-feature": ref,
      d: riverPath(river.points, river.width ?? 2)
    });
    this.g.paintRivers.append(node);
    if (river.name) {
      const spot = alongPath(river.points, 0.5);
      this.featureText(this.g.paintLabels, river.name, spot.x, spot.y - 4, "river-label", 14, spot.angle, ref);
    }
    this.featureIndex.push({ layer: "rivers", id: river.id, points: river.points, width: river.width ?? 2 });
  }

  renderFeatureLabel(label) {
    const ref = `labels:${label.id}`;
    const cls = { water: "river-label", range: "range-label", forest: "forest-label", region: "land-label", plain: "plain-label" }[label.kind] || "plain-label";
    this.featureText(this.g.paintLabels, label.text, label.x, label.y, cls, label.size ?? 18, label.rotate ?? 0, ref);
    this.featureIndex.push({ layer: "labels", id: label.id, x: label.x, y: label.y, r: (label.size ?? 18) * 0.9 });
  }

  renderMarker(marker) {
    const ref = `markers:${marker.id}`;
    const node = svgEl("g", { class: "paint-marker", "data-feature": ref, transform: `translate(${marker.x},${marker.y})` });
    const inner = svgEl("g");
    inner.innerHTML = `<circle class="marker-disc" r="8"/>${MARKER_GLYPHS[marker.kind] || MARKER_GLYPHS.star}`;
    node.append(inner);
    this.g.paintMarkers.append(node);
    this.paintScaled.push({ node: inner, base: 1 });
    if (marker.name) this.featureText(this.g.paintMarkers, marker.name, marker.x, marker.y + 17, "marker-label", 12, 0, ref);
    this.featureIndex.push({ layer: "markers", id: marker.id, x: marker.x, y: marker.y, r: 10 });
  }

  /** Надпись правки: контрмасштаб, чтобы кегль не плыл при приближении. */
  featureText(group, text, x, y, cls, size, rotate, ref) {
    const node = svgEl("g", { transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`, "data-feature": ref, class: "paint-text" });
    const inner = svgEl("g");
    const label = svgEl("text", {
      class: `map-label ${cls}`,
      "text-anchor": "middle",
      "font-size": size,
      transform: `rotate(${(rotate || 0).toFixed(1)})`
    });
    label.textContent = text;
    inner.append(label);
    node.append(inner);
    group.append(node);
    this.paintScaled.push({ node: inner, base: 1 });
    return node;
  }

  applyPaintStyle() {
    const scale = this.reliefScale || 1;
    for (const item of this.paintItems) {
      const box = item.box * item.size * scale;
      item.node.setAttribute("width", box.toFixed(2));
      item.node.setAttribute("height", box.toFixed(2));
      item.node.setAttribute("x", (-box / 2).toFixed(2));
      item.node.setAttribute("y", (-box).toFixed(2));
    }
    this.g.paintIcons.style.opacity = String(this.reliefInk ?? 1);
    this.g.paintForests.style.opacity = String(this.reliefInk ?? 1);
  }

  /** Ластик по подложке: прячем исходные знаки по координатам, реки — по идентификатору. */
  applyHidden(hidden) {
    const keys = new Set();
    const rivers = new Set();
    for (const item of hidden) {
      if (item.kind === "river") rivers.add(item.ref);
      else keys.add(`${Number(item.x).toFixed(1)},${Number(item.y).toFixed(1)}`);
    }
    for (const key of this.hiddenKeys) {
      if (!keys.has(key)) {
        const item = this.reliefByPoint?.get(key);
        if (item) item.node.style.display = "";
      }
    }
    for (const key of keys) {
      const item = this.reliefByPoint?.get(key);
      if (item) item.node.style.display = "none";
    }
    for (const river of this.baseRivers || []) {
      river.node.style.display = rivers.has(river.id) ? "none" : "";
    }
    this.hiddenKeys = keys;
    this.hiddenRivers = rivers;
  }

  /** Что лежит под кистью: свои правки и знаки подложки. */
  featuresNear(x, y, radius) {
    const out = [];
    for (const item of this.featureIndex) {
      if (item.points) {
        const inside = pointInPolygon(x, y, item.points);
        const near = inside || item.points.some((p, i) => {
          const q = item.points[(i + 1) % item.points.length];
          return segmentDistance(x, y, p, q) <= radius + (item.width || 1);
        });
        if (near) out.push({ layer: item.layer, id: item.id });
      } else if (Math.hypot(item.x - x, item.y - y) <= radius + (item.r || 6)) {
        out.push({ layer: item.layer, id: item.id });
      }
    }
    return out;
  }

  /** Ближайшая правка под указателем: знак важнее леса, лес важнее пустого места. */
  featureAt(x, y, tolerance = 8) {
    let best = null;
    let bestScore = Infinity;
    for (const item of this.featureIndex) {
      let score;
      if (item.points) {
        const inside = pointInPolygon(x, y, item.points);
        let distance = inside ? 0 : Infinity;
        if (!inside) {
          for (let i = 0; i < item.points.length; i++) {
            const a = item.points[i];
            const b = item.points[(i + 1) % item.points.length];
            distance = Math.min(distance, segmentDistance(x, y, a, b));
          }
        }
        if (distance > tolerance + (item.width || 0)) continue;
        score = 1000 + (item.layer === "rivers" ? 0 : 200) + distance;
      } else {
        const distance = Math.hypot(item.x - x, item.y - y) - (item.r || 6);
        if (distance > tolerance) continue;
        score = distance;
      }
      if (score < bestScore) {
        bestScore = score;
        best = { layer: item.layer, id: item.id };
      }
    }
    return best ? `${best.layer}:${best.id}` : null;
  }

  /** Город под указателем: захват указателя меняет цель щелчка, поэтому ищем по координатам. */
  cityAt(x, y, tolerance = 12) {
    const reach = tolerance / Math.max(0.5, this.view.k);
    let best = null;
    let bestDistance = Infinity;
    for (const city of this.world?.cities || []) {
      const distance = Math.hypot(city.x - x, city.y - y);
      if (distance <= reach && distance < bestDistance) {
        bestDistance = distance;
        best = city;
      }
    }
    return best;
  }

  /** Подписи подложки попадают в выбор и по промаху мимо букв: ищем по месту подписи. */
  baseLabelAt(x, y, tolerance = 10) {
    const k = Math.max(0.4, this.view.k);
    const candidates = [
      ...(this.world?.seas || []).map(item => ({ ref: `seas:${item.id}`, item, size: item.size || 22 })),
      ...(this.world?.ranges || []).map(item => ({ ref: `ranges:${item.id}`, item, size: item.size || 17 })),
      ...(this.world?.rivers || []).map(item => ({ ref: `rivers:${item.id}`, item, size: item.size || 15 })),
      ...(this.world?.countries || []).map(item => ({ ref: `country:${item.id}`, item: item.label || {}, name: item.name, size: item.label?.size || 24 }))
    ];
    let best = null;
    let bestScore = Infinity;
    for (const candidate of candidates) {
      const { item } = candidate;
      if (item.x === undefined || item.y === undefined) continue;
      const name = candidate.name || item.name || "";
      const halfWidth = (name.length * candidate.size * 0.28) / k;
      const halfHeight = (candidate.size * 0.6) / k;
      const dx = Math.abs(x - item.x);
      const dy = Math.abs(y - item.y);
      if (dx > halfWidth + tolerance || dy > halfHeight + tolerance) continue;
      const score = Math.hypot(dx, dy);
      if (score < bestScore) {
        bestScore = score;
        best = candidate.ref;
      }
    }
    return best;
  }

  baseIconsNear(x, y, radius) {
    const out = [];
    for (const item of this.reliefItems) {
      const cx = item.x + item.w / 2;
      const cy = item.y + item.h / 2;
      if (Math.hypot(cx - x, cy - y) <= radius + item.w * 0.3) out.push({ x: item.x, y: item.y, key: item.key });
    }
    return out;
  }

  featureNode(ref) {
    if (ref?.startsWith("country:")) return this.viewport.querySelector(`[data-country-label="${ref.slice(8)}"]`);
    return this.viewport.querySelector(`[data-feature="${ref}"], [data-base-label="${ref}"]`);
  }

  featureItem(ref) {
    const [layer, id] = String(ref).split(":");
    return (this.features()[layer] || []).find(item => item.id === id) || null;
  }

  /** Рамка выделения вокруг правки. */
  pick(ref) {
    this.g.pick.replaceChildren();
    if (!ref) return;
    const node = this.featureNode(ref);
    if (!node) return;
    const box = this.nodeBounds(node);
    if (!box) return;
    const pad = 4 / Math.max(0.4, this.view.k);
    this.g.pick.append(svgEl("rect", {
      class: "pick-box",
      x: (box.x - pad).toFixed(1),
      y: (box.y - pad).toFixed(1),
      width: (box.width + pad * 2).toFixed(1),
      height: (box.height + pad * 2).toFixed(1),
      rx: 3
    }));
  }

  /** Габариты узла в координатах карты: getBBox не учитывает собственные transform'ы. */
  nodeBounds(node) {
    let box;
    let matrix;
    try {
      box = node.getBBox();
      const screen = node.getScreenCTM();
      const root = this.viewport.getScreenCTM();
      if (!screen || !root) return null;
      matrix = root.inverse().multiply(screen);
    } catch {
      return null;
    }
    if (!box.width && !box.height) return null;
    const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
      .map(([x, y]) => ({ x: x * matrix.a + y * matrix.c + matrix.e, y: x * matrix.b + y * matrix.d + matrix.f }));
    const xs = corners.map(c => c.x);
    const ys = corners.map(c => c.y);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }

  setBrush(x, y, radius, kind = "brush") {
    this.g.brush.replaceChildren();
    if (x === null) return;
    this.g.brush.append(svgEl("circle", { class: `brush-ring ${kind}`, cx: x.toFixed(1), cy: y.toFixed(1), r: Math.max(1, radius).toFixed(1) }));
  }

  /** Черновик незавершённой правки: русло, контур, россыпь под кистью. */
  drawDraft(draft) {
    const group = this.g.draft;
    group.replaceChildren();
    if (!draft) return;
    if (draft.kind === "river") {
      if (draft.points.length > 1) group.append(svgEl("path", { class: "draft-line", d: smoothPath(draft.points) }));
    } else if (draft.kind === "lake" || draft.kind === "forest") {
      if (draft.points.length > 1) {
        group.append(svgEl("path", { class: `draft-area ${draft.kind}`, d: smoothPath(draft.points, draft.points.length > 2) }));
      }
    }
    for (const p of draft.points || []) {
      group.append(svgEl("circle", { class: "draft-node", cx: p[0], cy: p[1], r: 2.6 / Math.max(0.5, this.view.k) }));
    }
    for (const dab of draft.dabs || []) {
      group.append(svgEl("circle", { class: "draft-dab", cx: dab.x, cy: dab.y, r: dab.r }));
    }
    if (draft.link) group.append(svgEl("path", { class: "draft-link", d: `M${draft.link[0]},${draft.link[1]}L${draft.link[2]},${draft.link[3]}` }));
  }

  clearDraft() {
    this.g.draft.replaceChildren();
  }

  /** Рамка-«нитка» по краю листа: подложка заканчивается ровно на границе мира. */
  renderFrame() {
    const { width, height } = this.size();
    this.g.frame.append(
      svgEl("rect", { class: "sheet-edge", x: 0, y: 0, width, height }),
      svgEl("rect", { class: "sheet-edge inner", x: 7, y: 7, width: width - 14, height: height - 14 })
    );
  }

  renderGrid() {
    const { width, height } = this.size();
    for (let x = 100; x < width; x += 100) {
      this.g.grid.append(svgEl("path", { class: "grid-line", d: `M${x},0V${height}` }));
    }
    for (let y = 100; y < height; y += 100) {
      this.g.grid.append(svgEl("path", { class: "grid-line", d: `M0,${y}H${width}` }));
    }
  }

  renderLands() {
    for (const country of this.world.countries) {
      const d = country.paths.join(" ");
      const shape = svgEl("path", {
        class: "land-shape",
        d,
        fill: country.color,
        "fill-opacity": (this.tint / 100).toFixed(2),
        "fill-rule": "evenodd",
        "data-country": country.id
      });
      shape.addEventListener("click", () => {
        if (!this.suppressClick) this.handlers.select?.({ type: "country", id: country.id });
      });
      shape.addEventListener("pointerenter", event => this.handlers.hover?.(event, { type: "country", id: country.id }));
      shape.addEventListener("pointerleave", () => this.handlers.hover?.(null));
      this.g.lands.append(shape);
      this.g.borders.append(
        svgEl("path", {
          class: "land-border",
          "data-country": country.id,
          d,
          stroke: shade(country.color, -0.45),
          "stroke-width": 1.5,
          "stroke-opacity": 0.75,
          "stroke-dasharray": "7 3"
        })
      );

      const label = country.label || { x: 0, y: 0, rotate: 0, size: 24 };
      const node = svgEl("g", {
        transform: `translate(${label.x},${label.y})`,
        "data-country-label": country.id
      });
      const inner = svgEl("g");
      const text = svgEl("text", {
        class: "map-label land-label",
        "text-anchor": "middle",
        fill: shade(country.color, -0.55),
        "font-size": (label.size * 0.56).toFixed(1),
        transform: `rotate(${label.rotate || 0})`
      });
      text.textContent = country.name;
      inner.append(text);
      node.append(inner);
      this.g.landLabels.append(node);
      this.scaled.push({ node: inner, base: 1 });
    }
  }

  renderRoads() {
    for (const road of this.world.roads) {
      this.g.roads.append(svgEl("path", { class: `road ${road.kind}`, d: road.path }));
    }
  }

  renderHydro() {
    const add = (group, item, cls, sizeFactor = 0.6, layer = null) => {
      const node = svgEl("g", {
        transform: `translate(${item.x},${item.y})`,
        ...(layer ? { "data-base-label": `${layer}:${item.id}`, class: "base-label" } : {})
      });
      const inner = svgEl("g");
      const text = svgEl("text", {
        class: `map-label ${cls}`,
        "text-anchor": "middle",
        "font-size": ((item.size || 16) * sizeFactor).toFixed(1),
        transform: `rotate(${item.rotate || 0})`
      });
      text.textContent = item.name;
      inner.append(text);
      node.append(inner);
      this.g[group].append(node);
      this.scaled.push({ node: inner, base: 1 });
    };
    for (const sea of this.world.seas) add("seas", sea, "sea-label", 0.62, "seas");
    for (const range of this.world.ranges) add("ranges", range, "range-label", 0.62, "ranges");
    for (const river of this.world.rivers) add("rivers", { size: 15, ...river }, "river-label", 0.66, "rivers");
  }

  renderCities() {
    const capitalOf = new Set(this.world.countries.map(c => c.capital));
    for (const city of this.world.cities) {
      const isCapital = city.kind === "capital" || capitalOf.has(city.id);
      const node = svgEl("g", {
        class: `city-node ${city.kind}${isCapital ? " capital" : ""}${this.admin ? " draggable" : ""}`,
        transform: `translate(${city.x},${city.y})`,
        "data-city": city.id,
        tabindex: "0",
        role: "button",
        "aria-label": `${city.name}, ${KINDS[city.kind] || "поселение"}`
      });
      const inner = svgEl("g");
      inner.innerHTML = `<circle class="halo" r="9"/><circle class="hit" r="13"/>${GLYPHS[city.kind] || GLYPHS.town}`;
      node.append(inner);
      node.addEventListener("click", event => {
        if (this.placing) return; // в режиме постановки клик должен дойти до карты
        if (this.editor?.active && this.editor.tool !== "select") return; // кисть редактора важнее карточки
        event.stopPropagation();
        if (!this.suppressClick) this.handlers.select?.({ type: "city", id: city.id });
      });
      node.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.handlers.select?.({ type: "city", id: city.id });
        }
      });
      node.addEventListener("pointerenter", event => this.handlers.hover?.(event, { type: "city", id: city.id }));
      node.addEventListener("pointerleave", () => this.handlers.hover?.(null));
      node.addEventListener("pointerdown", event => {
        if (this.editor?.active && this.editor.tool !== "select") return; // город не перехватывает кисть
        if (this.admin && !this.placing) this.startCityDrag(event, city, node);
      });
      this.g.cities.append(node);
      this.scaled.push({ node: inner, base: 1 });

      const labelNode = svgEl("g", { transform: `translate(${city.x},${city.y})`, "data-city-label": city.id });
      const labelInner = svgEl("g");
      const text = svgEl("text", {
        class: `map-label city-label${isCapital ? " capital" : ""}`,
        x: isCapital ? 10 : 8,
        y: 4,
        "font-size": isCapital ? 14 : 12.5
      });
      text.textContent = city.name;
      labelInner.append(text);
      labelNode.append(labelInner);
      this.g.cityLabels.append(labelNode);
      this.scaled.push({ node: labelInner, base: 1 });
    }
  }

  applyZoom() {
    const { x, y, k } = this.view;
    this.viewport.setAttribute("transform", `translate(${x},${y}) scale(${k})`);
    const inverse = 1 / k;
    for (const item of this.scaled) item.node.setAttribute("transform", `scale(${inverse * item.base})`);
    for (const item of this.paintScaled) item.node.setAttribute("transform", `scale(${inverse * item.base})`);

    const detail = k > 2.2;
    const mid = k > 1.15;
    const passes = city => !this.predicate || this.predicate(city);
    for (const node of this.g.cityLabels.children) {
      const city = this.cityById.get(node.getAttribute("data-city-label"));
      if (!city) continue;
      const important = city.kind === "capital" || city.population >= 20000;
      const peeked = this.peek?.type === "city" && this.peek.id === city.id;
      const tier = detail || (mid && important) || (!mid && city.kind === "capital") || peeked;
      node.style.display = tier && passes(city) ? "" : "none";
    }
    for (const node of this.g.cities.children) {
      const city = this.cityById.get(node.getAttribute("data-city"));
      if (!city) continue;
      const minor = city.kind === "town" || city.kind === "shrine";
      node.style.display = passes(city) ? "" : "none";
      node.style.opacity = !mid && minor ? "0.55" : "1";
    }
    this.handlers.zoom?.(this.view);
  }

  applySelection() {
    for (const node of this.g.cities.children) {
      node.classList.toggle("selected", this.selected?.type === "city" && node.dataset.city === this.selected.id);
    }
    for (const node of this.g.lands.children) {
      const active = this.selected?.type === "country" && node.dataset.country === this.selected.id;
      node.classList.toggle("dim", Boolean(this.selected?.type === "country") && !active);
      node.setAttribute("fill-opacity", ((active ? Math.min(60, this.tint + 16) : this.tint) / 100).toFixed(2));
    }
  }

  select(selection) {
    this.selected = selection;
    this.applySelection();
  }

  /** Наведение на строку списка подсвечивает объект на карте — и наоборот. */
  setPeek(selection) {
    this.peek = selection;
    for (const node of this.g.cities.children) {
      node.classList.toggle("peek", selection?.type === "city" && node.dataset.city === selection.id);
    }
    for (const node of this.g.lands.children) {
      node.classList.toggle("peek", selection?.type === "country" && node.dataset.country === selection.id);
    }
    this.applyZoom();
  }

  highlight(ids) {
    this.matches = ids;
    for (const node of this.g.cities.children) node.classList.toggle("match", Boolean(ids && ids.has(node.dataset.city)));
  }

  filterCities(predicate) {
    this.predicate = predicate;
    this.applyZoom();
  }

  startPlacing() {
    this.placing = true;
    this.svg.classList.add("placing");
  }

  stopPlacing() {
    this.placing = false;
    this.svg.classList.remove("placing");
  }

  // ── обзор ────────────────────────────────────────────────────────────
  baseScale() {
    const rect = this.svg.getBoundingClientRect();
    const { width, height } = this.size();
    return Math.min(rect.width / width, rect.height / height) || 1;
  }

  toMap(clientX, clientY) {
    const ctm = this.viewport.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const point = this.svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  fit(animate = true) {
    const { width, height } = this.size();
    const rect = this.svg.getBoundingClientRect();
    const k = Math.min(rect.width / width, rect.height / height) * 0.98 / this.baseScale();
    this.animateTo({ k, x: (width - width * k) / 2, y: (height - height * k) / 2 }, animate);
  }

  zoomBy(factor, center) {
    const rect = this.svg.getBoundingClientRect();
    const cx = center?.x ?? rect.left + rect.width / 2;
    const cy = center?.y ?? rect.top + rect.height / 2;
    const before = this.toMap(cx, cy);
    const k = Math.max(this.limits.min, Math.min(this.limits.max, this.view.k * factor));
    const scale = k / this.view.k;
    this.view = {
      k,
      x: this.view.x + before.x * this.view.k * (1 - scale),
      y: this.view.y + before.y * this.view.k * (1 - scale)
    };
    this.applyZoom();
  }

  /** Сколько места отъедает панель сведений — город не должен уезжать под неё. */
  insets() {
    const panel = document.getElementById("detail");
    const rect = this.svg.getBoundingClientRect();
    if (!panel || panel.hidden || !rect.width) return { left: 0, top: 0, right: 0, bottom: 0 };
    const box = panel.getBoundingClientRect();
    if (box.width > rect.width * 0.85) return { left: 0, top: 0, right: 0, bottom: Math.max(0, rect.bottom - box.top) };
    return { left: 0, top: 0, right: Math.max(0, rect.right - box.left), bottom: 0 };
  }

  flyTo(x, y, k = Math.max(this.view.k, 3)) {
    const rect = this.svg.getBoundingClientRect();
    const base = this.baseScale();
    const target = Math.max(this.limits.min, Math.min(this.limits.max, k));
    const inset = this.insets();
    const freeW = Math.max(120, rect.width - inset.left - inset.right);
    const freeH = Math.max(120, rect.height - inset.top - inset.bottom);
    const offsetX = (rect.width - this.size().width * base) / 2;
    const offsetY = (rect.height - this.size().height * base) / 2;
    this.animateTo({
      k: target,
      x: (inset.left + freeW / 2 - offsetX) / base - x * target,
      y: (inset.top + freeH / 2 - offsetY) / base - y * target
    });
  }

  animateTo(target, animate = true) {
    if (!animate || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.view = target;
      this.applyZoom();
      return;
    }
    const from = { ...this.view };
    const start = performance.now();
    const duration = 520;
    const step = now => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      this.view = {
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        k: from.k + (target.k - from.k) * e
      };
      this.applyZoom();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  startCityDrag(event, city, node) {
    event.stopPropagation();
    const start = this.toMap(event.clientX, event.clientY);
    const origin = { x: city.x, y: city.y };
    let moved = false;
    node.classList.add("dragging");
    node.setPointerCapture?.(event.pointerId);
    const move = e => {
      const now = this.toMap(e.clientX, e.clientY);
      const dx = now.x - start.x;
      const dy = now.y - start.y;
      if (Math.hypot(dx, dy) > 2) moved = true;
      const { width, height } = this.size();
      const x = Math.max(0, Math.min(width, origin.x + dx));
      const y = Math.max(0, Math.min(height, origin.y + dy));
      node.setAttribute("transform", `translate(${x},${y})`);
      const label = this.g.cityLabels.querySelector(`[data-city-label="${city.id}"]`);
      label?.setAttribute("transform", `translate(${x},${y})`);
      node.dataset.pendingX = x.toFixed(1);
      node.dataset.pendingY = y.toFixed(1);
    };
    const up = () => {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", up);
      node.classList.remove("dragging");
      if (moved) {
        this.suppressClick = true;
        setTimeout(() => (this.suppressClick = false), 60);
        this.handlers.moveCity?.(city.id, Number(node.dataset.pendingX), Number(node.dataset.pendingY));
      }
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
  }

  bindEvents() {
    const svg = this.svg;
    svg.addEventListener("wheel", event => {
      event.preventDefault();
      this.zoomBy(Math.exp(-event.deltaY * 0.0016), { x: event.clientX, y: event.clientY });
      this.handlers.interact?.();
    }, { passive: false });

    svg.addEventListener("pointerdown", event => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      if (this.editor?.onPointerDown?.(event)) {
        svg.setPointerCapture?.(event.pointerId);
        this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        return;
      }
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.placing) return;
      if (this.pointers.size === 1) {
        this.pan = { x: event.clientX, y: event.clientY, view: { ...this.view }, moved: false };
        svg.setPointerCapture?.(event.pointerId);
      }
    });

    svg.addEventListener("pointermove", event => {
      this.editor?.onHover?.(event);
      if (this.editor?.onPointerMove?.(event)) return;
      if (!this.pointers.has(event.pointerId)) return;
      const previous = this.pointers.get(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinchDistance) {
          this.zoomBy(distance / this.pinchDistance, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        }
        this.pinchDistance = distance;
        this.pan = null;
        return;
      }
      if (!this.pan) return;
      const base = this.baseScale();
      const dx = (event.clientX - this.pan.x) / base;
      const dy = (event.clientY - this.pan.y) / base;
      if (Math.hypot(dx, dy) > 3) {
        this.pan.moved = true;
        svg.classList.add("dragging");
      }
      this.view = { ...this.pan.view, x: this.pan.view.x + dx, y: this.pan.view.y + dy };
      this.applyZoom();
      void previous;
    });

    const end = event => {
      const handled = this.editor?.onPointerUp?.(event);
      this.pointers.delete(event.pointerId);
      if (handled) {
        this.pan = null;
        svg.classList.remove("dragging");
        return;
      }
      if (this.pointers.size < 2) this.pinchDistance = null;
      if (this.pan?.moved) {
        this.suppressClick = true;
        setTimeout(() => (this.suppressClick = false), 60);
        this.handlers.interact?.();
      }
      this.pan = null;
      svg.classList.remove("dragging");
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("pointerleave", event => {
      this.editor?.onHover?.(null);
      end(event);
    });

    svg.addEventListener("dblclick", event => {
      event.preventDefault();
      if (this.editor?.onDoubleClick?.(event)) return;
      this.zoomBy(1.8, { x: event.clientX, y: event.clientY });
    });

    svg.addEventListener("click", event => {
      if (this.editor?.onClick?.(event)) return;
      if (this.suppressClick) return;
      if (this.placing) {
        const point = this.toMap(event.clientX, event.clientY);
        this.handlers.place?.(point);
        return;
      }
      if (event.target === svg || event.target.closest("#fmg-base")) this.handlers.select?.(null);
    });

    new ResizeObserver(() => this.handlers.resize?.(this.view)).observe(svg);
  }
}

export const cityTooltip = city =>
  `<b>${esc(city.name)}</b><small>${esc(KINDS[city.kind] || "поселение")} · ${esc(people(city.population))} чел.</small>`;

export const countryTooltip = country =>
  `<b>${esc(country.name)}</b><small>${esc(country.government || "земля")}${
    country.terrain && TERRAINS[country.terrain] ? ` · ${esc(TERRAINS[country.terrain].toLowerCase())}` : ""}</small>`;
