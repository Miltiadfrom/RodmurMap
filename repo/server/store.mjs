// Хранилище атласа: атомарная запись, история ревизий, нормализация связей.
import "./env.mjs";
import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = process.env.RODMUR_DATA_DIR || "data";
const WORLD_FILE = join(DATA_DIR, "world.json");
const HISTORY_DIR = join(DATA_DIR, "history");
const HISTORY_LIMIT = 30;

let world = null;
let worldMtime = 0;

export const FEATURE_LAYERS = ["icons", "hidden", "forests", "rivers", "lakes", "labels", "markers"];

/** Слой авторских правок поверх подложки: у старых миров его ещё нет. */
export function normalizeFeatures(next) {
  const features = next.features && typeof next.features === "object" ? next.features : {};
  next.features = Object.fromEntries(FEATURE_LAYERS.map(layer => [layer, Array.isArray(features[layer]) ? features[layer] : []]));
  return next;
}

/** Пакет правок карты применяется целиком: либо все операции, либо ни одной. */
export function applyFeatureOps(next, ops) {
  normalizeFeatures(next);
  for (const op of ops) {
    const list = next.features[op.layer];
    const index = list.findIndex(f => f.id === (op.item?.id ?? op.id));
    if (op.op === "add") {
      if (index >= 0) list[index] = op.item;
      else list.push(op.item);
    } else if (op.op === "update") {
      if (index >= 0) list[index] = { ...list[index], ...op.item };
    } else if (index >= 0) {
      list.splice(index, 1);
    }
  }
  return next;
}

/** Файл мог быть пересобран (`npm run build:world`) — подхватываем его без перезапуска. */
export function loadWorld() {
  if (!existsSync(WORLD_FILE)) throw new Error(`Нет файла мира: ${WORLD_FILE}. Запустите npm run build:world`);
  const mtime = statSync(WORLD_FILE).mtimeMs;
  if (!world || mtime !== worldMtime) {
    world = normalizeFeatures(JSON.parse(readFileSync(WORLD_FILE, "utf8")));
    worldMtime = mtime;
  }
  return world;
}

export function getWorld() {
  return loadWorld();
}

/** Пересчёт трактов: пути и длины следуют за городами, названия и тип остаются авторскими. */
export function relinkRoads(next) {
  const byId = new Map(next.cities.map(c => [c.id, c]));
  next.roads = (next.roads || []).flatMap((r, i) => {
    const a = byId.get(r.from);
    const b = byId.get(r.to);
    if (!a || !b) return [];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const bend = (r.kind === "sea" ? 0.16 : 0.07) * (i % 2 ? 1 : -1);
    const cx = (a.x + b.x) / 2 - dy * bend;
    const cy = (a.y + b.y) / 2 + dx * bend;
    return [{
      ...r,
      length: Math.round(len * next.meta.map.kmPerPx),
      path: `M${a.x},${a.y} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x},${b.y}`
    }];
  });
  return next;
}

/** Пересчёт сводных чисел страны: население, площадь и столица не редактируются вручную. */
export function restatCountries(next) {
  for (const country of next.countries) {
    const own = next.cities.filter(c => c.country === country.id);
    const urban = own.reduce((a, c) => a + (Number(c.population) || 0), 0);
    country.population = Math.round(urban * 4);
    if (!own.some(c => c.id === country.capital)) {
      country.capital = (own.find(c => c.kind === "capital") || own[0])?.id ?? null;
    }
  }
  return next;
}

function persist(next) {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(HISTORY_DIR, { recursive: true });
  const previous = readFileSync(WORLD_FILE, "utf8");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(join(HISTORY_DIR, `world-${String(next.meta.revision).padStart(5, "0")}-${stamp}.json`), previous);
  trimHistory();
  const tmp = `${WORLD_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 1));
  renameSync(tmp, WORLD_FILE);
  world = next;
  worldMtime = statSync(WORLD_FILE).mtimeMs;
  return next;
}

/** В летописи живут только последние HISTORY_LIMIT ревизий — диск не растёт без конца. */
function trimHistory() {
  const files = readdirSync(HISTORY_DIR).filter(f => f.endsWith(".json")).sort();
  for (const file of files.slice(0, Math.max(0, files.length - HISTORY_LIMIT))) {
    try {
      unlinkSync(join(HISTORY_DIR, file));
    } catch {
      /* история не критична */
    }
  }
}

/** Единственная точка записи: мутация → связи → статистика → ревизия → диск. */
export function commit(mutate, author = "хранитель") {
  const next = structuredClone(loadWorld());
  mutate(next);
  normalizeFeatures(next);
  relinkRoads(next);
  restatCountries(next);
  next.meta.revision = (next.meta.revision || 0) + 1;
  next.meta.updatedAt = new Date().toISOString();
  next.meta.updatedBy = author;
  return persist(next);
}

export function listHistory() {
  if (!existsSync(HISTORY_DIR)) return [];
  return readdirSync(HISTORY_DIR)
    .filter(f => f.endsWith(".json"))
    .sort()
    .reverse()
    .map(file => {
      const raw = JSON.parse(readFileSync(join(HISTORY_DIR, file), "utf8"));
      return {
        file,
        revision: raw.meta?.revision ?? 0,
        updatedAt: raw.meta?.updatedAt ?? null,
        updatedBy: raw.meta?.updatedBy ?? null,
        cities: raw.cities?.length ?? 0,
        countries: raw.countries?.length ?? 0
      };
    });
}

export function readHistory(file) {
  if (!/^world-[\d]+-[\d\-TZ]+\.json$/.test(file)) throw new Error("Недопустимое имя ревизии");
  const path = join(HISTORY_DIR, file);
  if (!existsSync(path)) throw new Error("Ревизия не найдена");
  return JSON.parse(readFileSync(path, "utf8"));
}
