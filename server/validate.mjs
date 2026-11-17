// Проверка входящих правок: атлас публичный, поэтому запись принимает только заведомо годные данные.

const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,48}$/;
const KINDS = new Set(["capital", "city", "town", "port", "fortress", "oasis", "shrine"]);
const TERRAINS = new Set(["", "meadow", "steppe", "savanna", "forest", "jungle", "desert", "tundra", "swamp"]);

const str = (v, min, max, field) => {
  if (typeof v !== "string") throw new Error(`Поле «${field}» должно быть строкой`);
  const t = v.trim();
  if (t.length < min || t.length > max) throw new Error(`Поле «${field}»: от ${min} до ${max} символов`);
  return t;
};
const num = (v, min, max, field) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Поле «${field}»: число от ${min} до ${max}`);
  return n;
};

const COUNTRY_TEXT = {
  name: [1, 60],
  fullName: [0, 120],
  government: [0, 120],
  ruler: [0, 120],
  motto: [0, 160],
  summary: [0, 400],
  description: [0, 4000],
  history: [0, 4000],
  economy: [0, 2000],
  military: [0, 2000]
};

const CITY_TEXT = {
  name: [1, 60],
  ruler: [0, 120],
  summary: [0, 400],
  description: [0, 4000]
};

export function countryPatch(body, world) {
  const patch = {};
  for (const [field, [min, max]] of Object.entries(COUNTRY_TEXT)) {
    if (body[field] !== undefined) patch[field] = str(body[field], min, max, field);
  }
  if (body.color !== undefined) {
    if (!HEX.test(body.color)) throw new Error("Цвет должен быть в формате #rrggbb");
    patch.color = body.color.toLowerCase();
  }
  if (body.capital !== undefined) {
    if (body.capital !== null && !world.cities.some(c => c.id === body.capital && c.country === body.id)) {
      throw new Error("Столица должна быть городом этой земли");
    }
    patch.capital = body.capital;
  }
  if (body.terrain !== undefined) {
    if (!TERRAINS.has(body.terrain)) throw new Error("Неизвестная природа земли");
    patch.terrain = body.terrain;
  }
  if (body.label !== undefined) patch.label = labelPatch(body.label, world);
  if (!Object.keys(patch).length) throw new Error("Нет полей для изменения");
  return patch;
}

export function cityPatch(body, world) {
  const patch = {};
  for (const [field, [min, max]] of Object.entries(CITY_TEXT)) {
    if (body[field] !== undefined) patch[field] = str(body[field], min, max, field);
  }
  if (body.kind !== undefined) {
    if (!KINDS.has(body.kind)) throw new Error("Неизвестный тип поселения");
    patch.kind = body.kind;
  }
  if (body.country !== undefined) {
    if (!world.countries.some(c => c.id === body.country)) throw new Error("Неизвестная земля");
    patch.country = body.country;
  }
  if (body.population !== undefined) patch.population = Math.round(num(body.population, 0, 50_000_000, "Население"));
  if (body.founded !== undefined) patch.founded = Math.round(num(body.founded, -5000, 5000, "Год основания"));
  if (body.x !== undefined) patch.x = +num(body.x, 0, world.meta.map.width, "X").toFixed(1);
  if (body.y !== undefined) patch.y = +num(body.y, 0, world.meta.map.height, "Y").toFixed(1);
  if (body.notables !== undefined) {
    if (!Array.isArray(body.notables) || body.notables.length > 12) throw new Error("Достопримечательности: список до 12 строк");
    patch.notables = body.notables.map(v => str(v, 1, 80, "Достопримечательность"));
  }
  if (body.port !== undefined) patch.port = Boolean(body.port);
  if (!Object.keys(patch).length) throw new Error("Нет полей для изменения");
  return patch;
}

export function newCity(body, world) {
  if (!ID.test(String(body.id || ""))) throw new Error("Идентификатор: латиница, цифры и дефис, до 49 символов");
  if (world.cities.some(c => c.id === body.id)) throw new Error("Такой идентификатор города уже есть");
  const patch = cityPatch({ ...body, kind: body.kind ?? "town" }, world);
  if (!patch.name) throw new Error("Укажите название");
  if (!patch.country) throw new Error("Укажите землю");
  if (patch.x === undefined || patch.y === undefined) throw new Error("Укажите координаты на карте");
  return {
    id: body.id,
    country: patch.country,
    name: patch.name,
    kind: patch.kind ?? "town",
    x: patch.x,
    y: patch.y,
    population: patch.population ?? 1000,
    founded: patch.founded ?? 1000,
    ruler: patch.ruler ?? "",
    summary: patch.summary ?? "",
    description: patch.description ?? "",
    notables: patch.notables ?? [],
    port: patch.port ?? false,
    river: null,
    elevation: 0
  };
}

export function labelPatch(label, world) {
  if (!label || typeof label !== "object") throw new Error("Некорректная подпись");
  return {
    x: +num(label.x, 0, world.meta.map.width, "X подписи").toFixed(1),
    y: +num(label.y, 0, world.meta.map.height, "Y подписи").toFixed(1),
    rotate: +num(label.rotate ?? 0, -180, 180, "Наклон подписи").toFixed(1),
    size: +num(label.size ?? 20, 8, 80, "Кегль подписи").toFixed(1)
  };
}

const RELIEF_SETS = new Set(["illustrated", "simple"]);
const LAYER_KEYS = ["tint", "grid", "roads", "seas", "hydro", "landLabels", "cities", "cityLabels"];

/** Оформление карты: набор знаков рельефа, крупность, густота, чернила, слои. */
export function appearancePatch(body) {
  if (!body || typeof body !== "object") throw new Error("Некорректное оформление");
  const out = {};
  if (body.reliefSet !== undefined) {
    if (!RELIEF_SETS.has(body.reliefSet)) throw new Error("Неизвестный набор знаков рельефа");
    out.reliefSet = body.reliefSet;
  }
  for (const [field, min, max, title] of [
    ["reliefScale", 0.5, 2, "Крупность рельефа"],
    ["reliefDensity", 0.1, 1, "Густота рельефа"],
    ["reliefInk", 0.1, 1, "Чернила рельефа"]
  ]) {
    if (body[field] !== undefined) out[field] = +num(body[field], min, max, title).toFixed(2);
  }
  if (body.tint !== undefined) out.tint = Math.round(num(body.tint, 0, 60, "Насыщенность земель"));
  for (const field of ["biomes", "texture"]) {
    if (body[field] !== undefined) out[field] = Boolean(body[field]);
  }
  if (body.layers !== undefined) {
    if (!body.layers || typeof body.layers !== "object") throw new Error("Некорректный список слоёв");
    out.layers = {};
    for (const key of LAYER_KEYS) {
      if (body.layers[key] !== undefined) out.layers[key] = Boolean(body.layers[key]);
    }
  }
  if (!Object.keys(out).length) throw new Error("Нет полей оформления");
  return out;
}

export function metaPatch(body) {
  const patch = {};
  for (const field of ["title", "subtitle", "era"]) {
    if (body[field] !== undefined) patch[field] = str(body[field], 1, 120, field);
  }
  if (body.intro !== undefined) patch.intro = str(body.intro, 0, 2000, "Вступление");
  if (body.appearance !== undefined) patch.appearance = appearancePatch(body.appearance);
  if (!Object.keys(patch).length) throw new Error("Нет полей для изменения");
  return patch;
}

/** Полная замена мира (импорт файла): проверяем целостность связей, а не только типы. */
export function wholeWorld(body) {
  if (!body || typeof body !== "object") throw new Error("Ожидался объект мира");
  if (!Array.isArray(body.countries) || !body.countries.length) throw new Error("В мире должна быть хотя бы одна земля");
  if (!Array.isArray(body.cities)) throw new Error("В мире должен быть список городов");
  if (!body.meta?.map?.width || !body.meta?.map?.height) throw new Error("Не заданы размеры карты");
  const ids = new Set();
  for (const c of body.countries) {
    if (!ID.test(String(c.id))) throw new Error(`Некорректный id земли: ${c.id}`);
    if (ids.has(c.id)) throw new Error(`Повторяющийся id: ${c.id}`);
    ids.add(c.id);
    if (!HEX.test(String(c.color))) throw new Error(`Некорректный цвет земли ${c.id}`);
    if (!Array.isArray(c.paths) || !c.paths.every(p => typeof p === "string")) throw new Error(`Нет контуров земли ${c.id}`);
    if (c.terrain !== undefined && !TERRAINS.has(c.terrain)) throw new Error(`Неизвестная природа земли ${c.id}`);
  }
  const cityIds = new Set();
  for (const c of body.cities) {
    if (!ID.test(String(c.id))) throw new Error(`Некорректный id города: ${c.id}`);
    if (cityIds.has(c.id)) throw new Error(`Повторяющийся id города: ${c.id}`);
    cityIds.add(c.id);
    if (!ids.has(c.country)) throw new Error(`Город ${c.id} ссылается на неизвестную землю`);
    if (!KINDS.has(c.kind)) throw new Error(`Неизвестный тип поселения у ${c.id}`);
  }
  if (body.features !== undefined) {
    if (!body.features || typeof body.features !== "object") throw new Error("Некорректный слой правок карты");
    const clean = {};
    for (const layer of FEATURE_LAYERS) {
      const list = body.features[layer] ?? [];
      if (!Array.isArray(list)) throw new Error(`Слой «${layer}» должен быть списком`);
      if (list.length > FEATURE_LIMITS[layer]) throw new Error(`Слой «${layer}» переполнен`);
      const seenIds = new Set();
      clean[layer] = list.map(item => {
        const value = featureItem(layer, item, body);
        if (seenIds.has(value.id)) throw new Error(`Повторяющийся объект карты: ${value.id}`);
        seenIds.add(value.id);
        return value;
      });
    }
    body.features = clean;
  }
  return body;
}

/* ── правки самой карты: знаки, леса, реки, озёра, надписи, метки ─────── */

export const ICON_TYPES = [
  "mount", "mountSnow", "hill", "vulcan", "conifer", "coniferSnow", "deciduous",
  "deadTree", "palm", "acacia", "cactus", "dune", "grass", "swamp"
];
export const FOREST_KINDS = ["conifer", "deciduous", "mixed", "jungle", "swamp", "dead"];
export const LABEL_KINDS = ["plain", "water", "range", "forest", "region"];
export const MARKER_KINDS = ["battle", "ruin", "mine", "temple", "tower", "anchor", "star", "skull"];
export const FEATURE_LAYERS = ["icons", "hidden", "forests", "rivers", "lakes", "labels", "markers"];

const FEATURE_LIMITS = { icons: 8000, hidden: 8000, forests: 300, rivers: 500, lakes: 300, labels: 600, markers: 600 };
const MAX_OPS = 4000;

const point = (value, world, field) => {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`Поле «${field}»: пара координат`);
  return [
    +num(value[0], -50, world.meta.map.width + 50, `${field} X`).toFixed(1),
    +num(value[1], -50, world.meta.map.height + 50, `${field} Y`).toFixed(1)
  ];
};

const outline = (value, world, field, min) => {
  if (!Array.isArray(value) || value.length < min || value.length > 600) {
    throw new Error(`Поле «${field}»: от ${min} до 600 точек`);
  }
  return value.map(p => point(p, world, field));
};

const featureId = body => {
  const id = String(body.id ?? "");
  if (!ID.test(id)) throw new Error("Некорректный идентификатор объекта карты");
  return id;
};

/** Приводим один объект правки к каноническому виду. */
export function featureItem(layer, body, world) {
  if (!body || typeof body !== "object") throw new Error("Некорректный объект карты");
  const id = featureId(body);
  const at = () => {
    const [x, y] = point([body.x, body.y], world, "Координаты");
    return { x, y };
  };
  switch (layer) {
    case "icons": {
      if (!ICON_TYPES.includes(body.type)) throw new Error("Неизвестный знак рельефа");
      return { id, type: body.type, ...at(), size: +num(body.size ?? 1, 0.3, 4, "Размер знака").toFixed(2) };
    }
    case "hidden": {
      const kind = body.kind ?? "relief";
      if (!["relief", "river"].includes(kind)) throw new Error("Неизвестный тип стёртого объекта");
      if (kind === "river") {
        const ref = String(body.ref ?? "");
        if (!/^[a-zA-Z0-9_-]{1,40}$/.test(ref)) throw new Error("Некорректная ссылка на реку подложки");
        return { id, kind, ref, ...at() };
      }
      return { id, kind: "relief", ...at() };
    }
    case "forests": {
      if (!FOREST_KINDS.includes(body.kind)) throw new Error("Неизвестная порода леса");
      return {
        id, kind: body.kind, name: str(body.name ?? "", 0, 80, "Название леса"),
        points: outline(body.points, world, "Контур леса", 3),
        density: +num(body.density ?? 1, 0.2, 2, "Густота леса").toFixed(2)
      };
    }
    case "rivers":
      return {
        id, name: str(body.name ?? "", 0, 80, "Название реки"),
        points: outline(body.points, world, "Русло реки", 2),
        width: +num(body.width ?? 2, 0.4, 12, "Ширина реки").toFixed(2)
      };
    case "lakes":
      return {
        id, name: str(body.name ?? "", 0, 80, "Название озера"),
        points: outline(body.points, world, "Берег озера", 3)
      };
    case "labels": {
      if (!LABEL_KINDS.includes(body.kind ?? "plain")) throw new Error("Неизвестный стиль надписи");
      return {
        id, kind: body.kind ?? "plain", text: str(body.text ?? "", 1, 120, "Текст надписи"),
        ...at(),
        size: +num(body.size ?? 18, 6, 90, "Кегль надписи").toFixed(1),
        rotate: +num(body.rotate ?? 0, -180, 180, "Наклон надписи").toFixed(1)
      };
    }
    case "markers": {
      if (!MARKER_KINDS.includes(body.kind)) throw new Error("Неизвестная метка");
      return { id, kind: body.kind, name: str(body.name ?? "", 0, 80, "Название метки"), ...at() };
    }
    default:
      throw new Error("Неизвестный слой карты");
  }
}

/** Пакет правок карты: одна операция — один объект, всё проверяется до записи. */
export function featureOps(body, world) {
  const list = Array.isArray(body?.ops) ? body.ops : null;
  if (!list || !list.length) throw new Error("Нет правок карты");
  if (list.length > MAX_OPS) throw new Error(`Слишком много правок за раз (до ${MAX_OPS})`);
  const counts = Object.fromEntries(FEATURE_LAYERS.map(l => [l, (world.features?.[l] || []).length]));
  const seen = new Set();
  return list.map(raw => {
    const layer = String(raw?.layer || "");
    if (!FEATURE_LAYERS.includes(layer)) throw new Error("Неизвестный слой карты");
    const op = String(raw?.op || "");
    if (!["add", "update", "remove"].includes(op)) throw new Error("Неизвестная операция");
    if (op === "remove") {
      const id = featureId(raw);
      counts[layer] = Math.max(0, counts[layer] - 1);
      return { op, layer, id };
    }
    if (op === "update") {
      const id = featureId({ id: raw.id ?? raw.item?.id ?? raw.patch?.id });
      const existing = (world.features?.[layer] || []).find(f => f.id === id);
      if (!existing) throw new Error("Объект карты не найден");
      const merged = { ...existing, ...(raw.patch || raw.item || {}), id };
      return { op, layer, item: featureItem(layer, merged, world) };
    }
    const item = featureItem(layer, raw.item, world);
    if (op === "add") {
      const key = `${layer}:${item.id}`;
      if (seen.has(key)) throw new Error("Повторяющийся идентификатор в пакете правок");
      seen.add(key);
      if ((world.features?.[layer] || []).some(f => f.id === item.id)) throw new Error("Такой объект карты уже есть");
      counts[layer] += 1;
      if (counts[layer] > FEATURE_LIMITS[layer]) throw new Error(`Слой «${layer}» переполнен (до ${FEATURE_LIMITS[layer]})`);
    }
    return { op, layer, item };
  });
}

/** Подписи подложки: моря, хребты и реки можно переименовать и передвинуть. */
export function baseLabelPatch(kind, body, world) {
  if (!["seas", "ranges", "rivers"].includes(kind)) throw new Error("Неизвестный слой подписей");
  const patch = {};
  if (body.name !== undefined) patch.name = str(body.name, 1, 80, "Название");
  if (body.x !== undefined) patch.x = +num(body.x, 0, world.meta.map.width, "X подписи").toFixed(1);
  if (body.y !== undefined) patch.y = +num(body.y, 0, world.meta.map.height, "Y подписи").toFixed(1);
  if (body.rotate !== undefined) patch.rotate = +num(body.rotate, -180, 180, "Наклон подписи").toFixed(1);
  if (body.size !== undefined) patch.size = +num(body.size, 6, 90, "Кегль подписи").toFixed(1);
  if (!Object.keys(patch).length) throw new Error("Нет полей для изменения");
  return patch;
}
