export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = value =>
  String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

export const nf = new Intl.NumberFormat("ru-RU");
export const num = n => nf.format(Math.round(Number(n) || 0));

export const people = n => {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2).replace(".", ",")} млн`;
  if (v >= 1000) return `${num(v / 1000)} тыс.`;
  return num(v);
};

export const area = n => `${num(n)} км²`;

export const KINDS = {
  capital: "Столица",
  city: "Город",
  town: "Городок",
  port: "Порт",
  fortress: "Крепость",
  oasis: "Оазис",
  shrine: "Святилище"
};

export const ROAD_KINDS = { royal: "Тракт", trade: "Торговый путь", sea: "Морской путь" };

/** Природа земли: чем покрыта территория под краской герба. */
export const TERRAINS = {
  "": "Как на подложке",
  meadow: "Зелёные луга",
  steppe: "Сухая степь",
  savanna: "Саванна",
  forest: "Густой лес",
  jungle: "Джунгли",
  desert: "Пустыня",
  tundra: "Тундра",
  swamp: "Болота"
};

export function debounce(fn, ms = 180) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function toast(message, kind = "", action = null) {
  const host = $("#toasts");
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  const text = document.createElement("span");
  text.textContent = message;
  node.append(text);
  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    node.style.transition = "opacity .4s, transform .4s";
    node.style.opacity = "0";
    node.style.transform = "translateY(8px)";
    setTimeout(() => node.remove(), 420);
  };
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      dismiss();
      action.onClick();
    });
    node.append(button);
  }
  host.append(node);
  timer = setTimeout(dismiss, action ? 7000 : 3200);
  return dismiss;
}

export const slug = value =>
  String(value)
    .toLowerCase()
    .replace(/[аеёиоуыэюя]/g, c => ({ а: "a", е: "e", ё: "e", и: "i", о: "o", у: "u", ы: "y", э: "e", ю: "yu", я: "ya" }[c]))
    .replace(/[бвгдзклмнпрстфхцч]/g, c => ({ б: "b", в: "v", г: "g", д: "d", з: "z", к: "k", л: "l", м: "m", н: "n", п: "p", р: "r", с: "s", т: "t", ф: "f", х: "h", ц: "c", ч: "ch" }[c]))
    .replace(/[жшщйьъ]/g, c => ({ ж: "zh", ш: "sh", щ: "sch", й: "y", ь: "", ъ: "" }[c]))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || `city-${Math.random().toString(36).slice(2, 7)}`;

/** Смешивание цвета с бумажным/чернильным тоном — для контуров и подписей земель. */
export function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = c => Math.round(c + (target - c) * p);
  return `#${((1 << 24) + (mix(r) << 16) + (mix(g) << 8) + mix(b)).toString(16).slice(1)}`;
}

export const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, v);
  return node;
};
