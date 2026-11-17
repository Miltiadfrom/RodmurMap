// Редактор карты хранителя: знаки рельефа и леса, лесные массивы, реки, озёра,
// надписи, метки, поселения и пути. Всё рисуется прямо по карте и сразу пишется на сервер.
import { $, $$, esc, toast, TERRAINS } from "./util.js";
import { simplify } from "./geometry.js";

const uid = prefix => `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
const hiddenId = (x, y) => `h${Math.round(x * 10)}n${Math.round(y * 10)}`.replace(/-/g, "n");
const clone = value => JSON.parse(JSON.stringify(value));

export const ICON_OPTIONS = [
  { value: "mount", label: "Гора", glyph: "M2 18L9 5l7 13z" },
  { value: "mountSnow", label: "Снежная гора", glyph: "M2 18L9 5l7 13zM6.2 10h5.6" },
  { value: "hill", label: "Холм", glyph: "M2 17c3-7 11-7 14 0z" },
  { value: "vulcan", label: "Вулкан", glyph: "M3 18l4-9h4l4 9zM7.5 9l1.5-4 1.5 4" },
  { value: "conifer", label: "Хвойный", glyph: "M9 3l4 6H5zM9 8l5 7H4zM9 15v3" },
  { value: "deciduous", label: "Лиственный", glyph: "M9 4a5 5 0 010 9 5 5 0 010-9zM9 13v5" },
  { value: "coniferSnow", label: "Снежный лес", glyph: "M9 3l4 6H5zM9 8l5 7H4zM9 15v3M4 12h10" },
  { value: "deadTree", label: "Сушостой", glyph: "M9 18V6M9 9L5 5M9 11l4-4" },
  { value: "palm", label: "Пальма", glyph: "M9 18V8M9 8c-3-3-6-2-7 0M9 8c3-3 6-2 7 0M9 8c0-4 2-5 4-5" },
  { value: "acacia", label: "Акация", glyph: "M9 18v-7M3 9h12M4 9c1-3 9-3 10 0" },
  { value: "cactus", label: "Кактус", glyph: "M9 18V6M9 11H6V8M9 13h3V9" },
  { value: "dune", label: "Дюны", glyph: "M2 15c3-4 5-4 7 0M8 15c3-4 5-4 7 0" },
  { value: "grass", label: "Степь", glyph: "M4 17V9M8 17V6M12 17V9M16 17v-6" },
  { value: "swamp", label: "Болото", glyph: "M3 12h4M8 15h5M11 10h4M5 8h3" }
];

const FOREST_OPTIONS = [
  { value: "conifer", label: "Хвойный бор" },
  { value: "deciduous", label: "Лиственный лес" },
  { value: "mixed", label: "Смешанный лес" },
  { value: "jungle", label: "Джунгли" },
  { value: "swamp", label: "Болота" },
  { value: "dead", label: "Мёртвый лес" }
];

const TERRAIN_OPTIONS = Object.entries(TERRAINS).map(([value, label]) => ({ value, label }));

const LABEL_OPTIONS = [
  { value: "plain", label: "Обычная" },
  { value: "water", label: "Вода — курсив" },
  { value: "range", label: "Хребет — разрядка" },
  { value: "forest", label: "Лес — зелёная" },
  { value: "region", label: "Земля — крупная" }
];

const MARKER_OPTIONS = [
  { value: "battle", label: "Битва" },
  { value: "ruin", label: "Руины" },
  { value: "mine", label: "Копи" },
  { value: "temple", label: "Храм" },
  { value: "tower", label: "Башня" },
  { value: "anchor", label: "Гавань" },
  { value: "star", label: "Диво" },
  { value: "skull", label: "Погибель" }
];

const pct = v => `${Math.round(v * 100)}%`;
const px = v => `${Math.round(v)} пк`;

const TOOLS = [
  {
    id: "select", caption: "Выбор", name: "Выбор и перенос", key: "v",
    hint: "Щёлкните объект карты или подпись, чтобы править его. Перетаскивание двигает объект, пустое место — обзор.",
    icon: "M5 3l14 7-6 2-2 6z",
    controls: []
  },
  {
    id: "hand", caption: "Обзор", name: "Обзор карты", key: "h",
    hint: "Перетаскивание — панорама, колесо — масштаб. Правки не вносятся.",
    icon: "M6 11V6.5a1.5 1.5 0 013 0V11m0-1V5a1.5 1.5 0 013 0v5m0-1V6.5a1.5 1.5 0 013 0V14a6 6 0 01-6 6H10a5 5 0 01-5-5v-3l-1-2a1.5 1.5 0 012.4-1.8L6 11",
    controls: []
  },
  {
    id: "icon", caption: "Знаки", name: "Знаки: горы, холмы, деревья", key: "r",
    hint: "Ведите кистью по карте — знаки лягут россыпью. Одиночный щелчок ставит один знак.",
    icon: "M2 19L9 6l4 7 2-3 5 9z",
    controls: [
      { type: "chips", key: "type", label: "Знак", options: ICON_OPTIONS },
      { type: "range", key: "size", label: "Размер знака", min: 0.4, max: 2.6, step: 0.05, fmt: pct },
      { type: "range", key: "brush", label: "Ширина кисти", min: 4, max: 90, step: 2, fmt: px },
      { type: "range", key: "spacing", label: "Шаг россыпи", min: 8, max: 60, step: 2, fmt: px },
      { type: "range", key: "jitter", label: "Разброс", min: 0, max: 1, step: 0.05, fmt: pct },
      { type: "switch", key: "single", label: "Ставить по одному знаку" }
    ]
  },
  {
    id: "forest", caption: "Лес", name: "Лес массивом", key: "f",
    hint: "Обведите границу леса щелчками. Enter или двойной щелчок — замкнуть, Esc — отменить, Backspace — убрать точку.",
    icon: "M8 3l4 6H4zM8 8l5 7H3zM8 15v4M16 6l3 5h-6zM16 11v8",
    controls: [
      { type: "select", key: "kind", label: "Порода", options: FOREST_OPTIONS },
      { type: "text", key: "name", label: "Название леса", placeholder: "Ловчий бор" },
      { type: "range", key: "density", label: "Густота деревьев", min: 0.3, max: 2, step: 0.05, fmt: pct },
      { type: "switch", key: "smooth", label: "Сглаживать контур" }
    ]
  },
  {
    id: "river", caption: "Река", name: "Река", key: "w",
    hint: "Ставьте точки от истока к устью. Enter или двойной щелчок — провести русло, Backspace — убрать точку.",
    icon: "M4 4c4 3 0 6 4 9s2 5 2 7",
    controls: [
      { type: "text", key: "name", label: "Название реки", placeholder: "Тихая" },
      { type: "range", key: "width", label: "Ширина русла", min: 0.6, max: 10, step: 0.2, fmt: v => `${v.toFixed(1)} пк` },
      { type: "switch", key: "smooth", label: "Сглаживать русло" }
    ]
  },
  {
    id: "lake", caption: "Озеро", name: "Озеро", key: "l",
    hint: "Обведите берег щелчками и замкните контур клавишей Enter или двойным щелчком.",
    icon: "M3 12c2-5 6-7 10-5s6 6 3 9-11 3-13-4z",
    controls: [
      { type: "text", key: "name", label: "Название озера", placeholder: "Светлое озеро" },
      { type: "switch", key: "smooth", label: "Сглаживать берег" }
    ]
  },
  {
    id: "label", caption: "Надпись", name: "Надпись на карте", key: "t",
    hint: "Щёлкните место — надпись встанет туда. Текст, кегль и наклон правятся в свойствах ниже.",
    icon: "M4 6V4h16v2M12 4v16M9 20h6",
    controls: [
      { type: "text", key: "text", label: "Текст", placeholder: "Пустоши Хаар" },
      { type: "select", key: "kind", label: "Стиль", options: LABEL_OPTIONS },
      { type: "range", key: "size", label: "Кегль", min: 8, max: 60, step: 1, fmt: px },
      { type: "range", key: "rotate", label: "Наклон", min: -90, max: 90, step: 1, fmt: v => `${v}°` }
    ]
  },
  {
    id: "marker", caption: "Метка", name: "Метка места", key: "m",
    hint: "Щёлкните по карте — метка встанет туда. Название подписывается под знаком.",
    icon: "M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11zM12 8.5v3.5",
    controls: [
      { type: "chips", key: "kind", label: "Метка", options: MARKER_OPTIONS, compact: true },
      { type: "text", key: "name", label: "Название места", placeholder: "Брод Пяти Камней" }
    ]
  },
  {
    id: "city", caption: "Город", name: "Поселение", key: "c",
    hint: "Щёлкните по карте — откроется карточка нового поселения со всеми сведениями.",
    icon: "M4 20V9l5-4 5 4v11M14 20V12h6v8M7 20v-5h4v5",
    controls: [
      { type: "select", key: "kind", label: "Тип поселения", options: [
        { value: "capital", label: "Столица" }, { value: "city", label: "Город" },
        { value: "town", label: "Городок" }, { value: "port", label: "Порт" },
        { value: "fortress", label: "Крепость" }, { value: "oasis", label: "Оазис" },
        { value: "shrine", label: "Святилище" }
      ] },
      { type: "text", key: "name", label: "Название", placeholder: "Новый острог" }
    ]
  },
  {
    id: "road", caption: "Путь", name: "Путь между городами", key: "p",
    hint: "Щёлкните первый город, затем второй — между ними ляжет путь.",
    icon: "M5 19a3 3 0 100-6 3 3 0 000 6zM19 11a3 3 0 100-6 3 3 0 000 6zM7.5 15.5C12 14 12 10 16.5 9",
    controls: [
      { type: "select", key: "kind", label: "Вид пути", options: [
        { value: "royal", label: "Тракт" }, { value: "trade", label: "Торговый путь" }, { value: "sea", label: "Морской переход" }
      ] }
    ]
  },
  {
    id: "erase", caption: "Ластик", name: "Ластик", key: "e",
    hint: "Ведите по карте: свои знаки, леса, реки, озёра, надписи и метки исчезают. Знаки подложки тоже стираются.",
    icon: "M8 20l-4-4 9-9 4 4-9 9zM11 20h9M13 7l4 4",
    controls: [
      { type: "range", key: "radius", label: "Радиус ластика", min: 6, max: 90, step: 2, fmt: px },
      { type: "switch", key: "base", label: "Стирать знаки подложки" },
      { type: "switch", key: "baseRivers", label: "Стирать реки подложки" },
      { type: "switch", key: "shapes", label: "Стирать свои леса, реки и озёра" }
    ]
  },
  {
    id: "restore", caption: "Вернуть", name: "Вернуть подложку", key: "u",
    hint: "Ведите по стёртым местам — исходные знаки гор и реки подложки возвращаются на карту.",
    icon: "M4 12a8 8 0 1114 5M4 12V6M4 12h6",
    controls: [
      { type: "range", key: "radius", label: "Радиус возврата", min: 6, max: 90, step: 2, fmt: px },
      { type: "switch", key: "relief", label: "Возвращать знаки рельефа" },
      { type: "switch", key: "rivers", label: "Возвращать реки" }
    ]
  }
];

const DEFAULTS = {
  select: {},
  hand: {},
  icon: { type: "mount", size: 1, brush: 26, spacing: 22, jitter: 0.55, single: false },
  forest: { kind: "conifer", name: "", density: 1, smooth: true },
  river: { name: "", width: 2.4, smooth: true },
  lake: { name: "", smooth: true },
  label: { text: "", kind: "plain", size: 18, rotate: 0 },
  marker: { kind: "star", name: "" },
  city: { kind: "town", name: "" },
  road: { kind: "trade" },
  erase: { radius: 22, base: true, baseRivers: true, shapes: true },
  restore: { radius: 30, relief: true, rivers: true }
};

export class MapEditor {
  constructor(atlas, hooks) {
    this.atlas = atlas;
    this.hooks = hooks;
    this.active = false;
    this.tool = "select";
    this.settings = clone(DEFAULTS);
    this.selected = null;
    this.draft = null;
    this.stroke = null;
    this.drag = null;
    this.undoStack = [];
    this.redoStack = [];
    this.pending = [];
    this.busy = false;
    this.roadFrom = null;
    this.frame = 0;
    try {
      const saved = JSON.parse(localStorage.getItem("rodmur.editor") || "null");
      if (saved) for (const key of Object.keys(DEFAULTS)) Object.assign(this.settings[key], saved[key] || {});
    } catch { /* настройки не критичны */ }
    this.buildRail();
    this.wire();
  }

  /* ── оболочка ─────────────────────────────────────────────────────── */

  buildRail() {
    const rail = $("#editorRail");
    rail.replaceChildren();
    for (const tool of TOOLS) {
      const button = document.createElement("button");
      button.className = "tool-btn";
      button.dataset.tool = tool.id;
      button.type = "button";
      button.title = `${tool.name} · ${tool.key.toUpperCase()}`;
      button.setAttribute("aria-label", tool.name);
      button.innerHTML =
        `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${tool.icon}"/></svg>` +
        `<span>${esc(tool.caption || tool.name)}</span><kbd>${tool.key.toUpperCase()}</kbd>`;
      button.addEventListener("click", () => this.setTool(tool.id));
      rail.append(button);
    }
  }

  wire() {
    $("#editorExit").addEventListener("click", () => this.deactivate());
    $("#editorUndo").addEventListener("click", () => this.undo());
    $("#editorRedo").addEventListener("click", () => this.redo());
    $("#editorControls").addEventListener("input", event => this.onControlInput(event));
    $("#editorControls").addEventListener("change", event => this.onControlInput(event));
    $("#editorControls").addEventListener("click", event => {
      const chip = event.target.closest("[data-chip]");
      if (!chip) return;
      this.settings[this.tool][chip.dataset.key] = chip.dataset.chip;
      this.saveSettings();
      this.renderControls();
    });
    $("#editorSelection").addEventListener("input", event => this.onPropertyInput(event, false));
    $("#editorSelection").addEventListener("change", event => this.onPropertyInput(event, true));
    $("#editorSelection").addEventListener("click", event => {
      const action = event.target.closest("[data-prop-action]")?.dataset.propAction;
      if (!action) return;
      if (action === "delete") this.deleteSelected();
      if (action === "duplicate") this.duplicateSelected();
      if (action === "open") this.hooks.openSelection?.(this.selected);
      if (action === "finish") this.finishDraft();
      if (action === "cancel") this.cancelDraft();
    });
  }

  saveSettings() {
    try {
      localStorage.setItem("rodmur.editor", JSON.stringify(this.settings));
    } catch { /* приватный режим */ }
  }

  activate() {
    if (this.active) return;
    this.active = true;
    this.atlas.editor = this;
    document.body.classList.add("editing");
    $("#editor").hidden = false;
    $("#editorBtn")?.classList.add("on");
    this.setTool(this.tool);
    this.renderStatus();
    toast("Редактор карты открыт. Правки сохраняются сразу.", "good");
  }

  deactivate() {
    if (!this.active) return;
    this.cancelDraft();
    this.clearPick();
    this.active = false;
    this.atlas.editor = null;
    this.atlas.setBrush(null);
    document.body.classList.remove("editing");
    $("#editor").hidden = true;
    $("#editorBtn")?.classList.remove("on");
    this.hooks.onExit?.();
  }

  setTool(id) {
    if (!TOOLS.some(t => t.id === id)) return;
    this.cancelDraft();
    this.roadFrom = null;
    this.tool = id;
    $$("#editorRail .tool-btn").forEach(b => b.classList.toggle("active", b.dataset.tool === id));
    const tool = TOOLS.find(t => t.id === id);
    $("#editorToolName").textContent = tool.name;
    $("#editorToolHint").textContent = tool.hint;
    $("#atlas").dataset.tool = id;
    this.renderControls();
    this.renderSelection();
    this.atlas.setBrush(null);
  }

  renderControls() {
    const host = $("#editorControls");
    const tool = TOOLS.find(t => t.id === this.tool);
    const values = this.settings[this.tool];
    host.replaceChildren();
    if (!tool.controls.length) {
      const note = document.createElement("p");
      note.className = "editor-note";
      note.textContent = this.tool === "select"
        ? "Выберите объект на карте — его свойства появятся ниже. Клавиша Delete удаляет правку."
        : "Колесо мыши — масштаб, перетаскивание — обзор. Инструменты слева меняются горячими клавишами.";
      host.append(note);
      return;
    }
    for (const control of tool.controls) {
      host.append(this.buildControl(control, values[control.key], value => {
        values[control.key] = value;
        this.saveSettings();
      }));
    }
  }

  buildControl(control, value, onChange) {
    if (control.type === "chips") {
      const wrap = document.createElement("div");
      wrap.className = "ctl-chips";
      wrap.innerHTML = `<span class="ctl-title">${esc(control.label)}</span>`;
      const grid = document.createElement("div");
      grid.className = `chip-grid${control.compact ? " compact" : ""}`;
      for (const option of control.options) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = `chip-pick${option.value === value ? " active" : ""}`;
        chip.dataset.chip = option.value;
        chip.dataset.key = control.key;
        chip.title = option.label;
        chip.innerHTML = option.glyph
          ? `<svg viewBox="0 0 18 22" aria-hidden="true"><path d="${option.glyph}"/></svg><span>${esc(option.label)}</span>`
          : `<span>${esc(option.label)}</span>`;
        grid.append(chip);
      }
      wrap.append(grid);
      return wrap;
    }
    const label = document.createElement("label");
    label.className = `ctl ${control.type}`;
    if (control.type === "range") {
      const output = document.createElement("b");
      output.textContent = control.fmt ? control.fmt(Number(value)) : String(value);
      const head = document.createElement("span");
      head.append(document.createTextNode(control.label), output);
      const input = document.createElement("input");
      input.type = "range";
      input.min = control.min;
      input.max = control.max;
      input.step = control.step;
      input.value = value;
      const push = final => {
        const next = Number(input.value);
        output.textContent = control.fmt ? control.fmt(next) : String(next);
        onChange(next, final);
      };
      input.addEventListener("input", () => push(false));
      input.addEventListener("change", () => push(true));
      label.append(head, input);
      return label;
    }
    if (control.type === "select") {
      const head = document.createElement("span");
      head.textContent = control.label;
      const select = document.createElement("select");
      for (const option of control.options) {
        const node = document.createElement("option");
        node.value = option.value;
        node.textContent = option.label;
        select.append(node);
      }
      select.value = value;
      select.addEventListener("change", () => onChange(select.value, true));
      label.append(head, select);
      return label;
    }
    if (control.type === "switch") {
      label.className = "switch";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(value);
      input.addEventListener("change", () => onChange(input.checked, true));
      const knob = document.createElement("span");
      label.append(input, knob, document.createTextNode(control.label));
      return label;
    }
    const head = document.createElement("span");
    head.textContent = control.label;
    const input = document.createElement("input");
    input.type = "text";
    input.value = value ?? "";
    input.placeholder = control.placeholder || "";
    input.maxLength = 120;
    input.addEventListener("input", () => onChange(input.value, false));
    input.addEventListener("change", () => onChange(input.value, true));
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        onChange(input.value, true);
        input.blur();
      }
    });
    label.append(head, input);
    return label;
  }

  onControlInput(event) {
    if (event.target.matches("input[type=range]") && this.selected) this.renderSelection();
  }

  renderStatus() {
    const counts = this.atlas.features();
    const total = counts.icons.length + counts.forests.length + counts.rivers.length +
      counts.lakes.length + counts.labels.length + counts.markers.length;
    $("#editorCount").innerHTML =
      `<b>${total}</b> правок · <b>${counts.hidden.length}</b> стёртых знаков` +
      `<small>${counts.icons.length} знаков · ${counts.forests.length} лесов · ${counts.rivers.length} рек · ` +
      `${counts.lakes.length} озёр · ${counts.labels.length} надписей · ${counts.markers.length} меток</small>`;
    $("#editorUndo").disabled = !this.undoStack.length || this.busy;
    $("#editorRedo").disabled = !this.redoStack.length || this.busy;
    $("#editorUndo").title = this.undoStack.length ? `Отменить: ${this.undoStack.at(-1).label}` : "Нечего отменять";
    $("#editorRedo").title = this.redoStack.length ? `Вернуть: ${this.redoStack.at(-1).label}` : "Нечего возвращать";
  }

  /* ── свойства выбранного объекта ──────────────────────────────────── */

  clearPick() {
    this.selected = null;
    this.atlas.pick(null);
    this.renderSelection();
  }

  pick(ref) {
    this.selected = ref;
    this.atlas.pick(ref);
    this.renderSelection();
  }

  selectionItem() {
    if (!this.selected) return null;
    const [layer, id] = this.selected.split(":");
    if (["seas", "ranges", "rivers"].includes(layer) && !this.atlas.features().rivers.some(r => r.id === id)) {
      return { layer, item: (this.hooks.world()[layer] || []).find(x => x.id === id), base: true };
    }
    if (layer === "country") {
      return { layer, item: this.hooks.world().countries.find(c => c.id === id), base: true };
    }
    const item = this.atlas.featureItem(this.selected);
    return item ? { layer, item, base: false } : null;
  }

  renderSelection() {
    const host = $("#editorSelection");
    host.replaceChildren();
    if (this.draft) {
      const box = document.createElement("div");
      box.className = "prop-card draft";
      box.innerHTML =
        `<h4>Незавершённая правка</h4><p class="editor-note">${this.draft.points.length} точек. ` +
        `Enter — закончить, Backspace — убрать точку, Esc — отменить.</p>` +
        `<div class="prop-actions"><button class="solid-btn" data-prop-action="finish" ${this.draft.points.length < this.minPoints() ? "disabled" : ""}>Закончить</button>` +
        `<button class="ghost-btn" data-prop-action="cancel">Отменить</button></div>`;
      host.append(box);
      return;
    }
    const found = this.selectionItem();
    if (!found || !found.item) {
      const box = document.createElement("div");
      box.className = "prop-card empty";
      box.innerHTML = `<h4>Ничего не выбрано</h4><p class="editor-note">Инструмент «Выбор» показывает здесь свойства объекта: название, размер, породу, кегль.</p>`;
      host.append(box);
      return;
    }
    const { layer, item, base } = found;
    const card = document.createElement("div");
    card.className = "prop-card";
    const titles = {
      icons: "Знак рельефа", forests: "Лес", rivers: base ? "Река подложки" : "Река",
      lakes: "Озеро", labels: "Надпись", markers: "Метка", seas: "Море", ranges: "Хребет", country: "Земля"
    };
    const kindNames = Object.fromEntries([...ICON_OPTIONS, ...FOREST_OPTIONS, ...MARKER_OPTIONS, ...LABEL_OPTIONS].map(o => [o.value, o.label]));
    const subtitle = item.name || item.text || kindNames[item.type || item.kind] || item.id;
    card.innerHTML = `<h4>${esc(titles[layer] || "Объект")}<small>${esc(subtitle)}</small></h4>`;
    const fields = document.createElement("div");
    fields.className = "prop-fields";
    const add = (control, value) => fields.append(this.buildControl(control, value, (next, final) => {
      this.applyProperty(control.key, next, final);
    }));

    if (layer === "icons") {
      add({ type: "select", key: "type", label: "Знак", options: ICON_OPTIONS }, item.type);
      add({ type: "range", key: "size", label: "Размер", min: 0.4, max: 2.6, step: 0.05, fmt: pct }, item.size ?? 1);
    } else if (layer === "forests") {
      add({ type: "text", key: "name", label: "Название", placeholder: "Ловчий бор" }, item.name);
      add({ type: "select", key: "kind", label: "Порода", options: FOREST_OPTIONS }, item.kind);
      add({ type: "range", key: "density", label: "Густота", min: 0.3, max: 2, step: 0.05, fmt: pct }, item.density ?? 1);
    } else if (layer === "rivers" && !base) {
      add({ type: "text", key: "name", label: "Название", placeholder: "Тихая" }, item.name);
      add({ type: "range", key: "width", label: "Ширина русла", min: 0.6, max: 10, step: 0.2, fmt: v => `${v.toFixed(1)} пк` }, item.width ?? 2);
    } else if (layer === "lakes") {
      add({ type: "text", key: "name", label: "Название", placeholder: "Светлое озеро" }, item.name);
    } else if (layer === "labels") {
      add({ type: "text", key: "text", label: "Текст" }, item.text);
      add({ type: "select", key: "kind", label: "Стиль", options: LABEL_OPTIONS }, item.kind);
      add({ type: "range", key: "size", label: "Кегль", min: 8, max: 60, step: 1, fmt: px }, item.size ?? 18);
      add({ type: "range", key: "rotate", label: "Наклон", min: -90, max: 90, step: 1, fmt: v => `${v}°` }, item.rotate ?? 0);
    } else if (layer === "markers") {
      add({ type: "text", key: "name", label: "Название" }, item.name);
      add({ type: "select", key: "kind", label: "Метка", options: MARKER_OPTIONS }, item.kind);
    } else if (base) {
      add({ type: "text", key: "name", label: "Название" }, item.name);
      if (layer === "country") {
        add({ type: "select", key: "terrain", label: "Природа земли", options: TERRAIN_OPTIONS }, item.terrain || "");
      }
      const label = layer === "country" ? item.label || {} : item;
      add({ type: "range", key: "size", label: "Кегль", min: 8, max: 60, step: 1, fmt: px }, label.size ?? 18);
      add({ type: "range", key: "rotate", label: "Наклон", min: -90, max: 90, step: 1, fmt: v => `${v}°` }, label.rotate ?? 0);
    }
    card.append(fields);

    const actions = document.createElement("div");
    actions.className = "prop-actions";
    if (!base) {
      actions.innerHTML =
        `<button class="ghost-btn" data-prop-action="duplicate">Дублировать</button>` +
        `<button class="ghost-btn danger" data-prop-action="delete">Удалить</button>`;
    } else if (layer === "country") {
      actions.innerHTML = `<button class="ghost-btn" data-prop-action="open">Карточка земли</button>`;
    } else {
      actions.innerHTML = `<span class="editor-note">Подпись подложки: имя, кегль и место можно менять, сам объект — нет.</span>`;
    }
    card.append(actions);
    host.append(card);
  }

  /** Правка свойства: мгновенный показ на карте, запись — когда ввод закончен.
      Первое изменение запоминает исходное значение, чтобы отмена работала честно. */
  applyProperty(key, value, final = false) {
    const found = this.selectionItem();
    if (!found?.item) return;
    const { layer, item, base } = found;
    if (layer === "labels" && key === "text" && !String(value).trim()) return;
    const memory = (this.propBefore ||= new Map());
    const memoryKey = `${this.selected}:${key}`;
    if (!memory.has(memoryKey)) {
      const labelKey = layer === "country" && key !== "name" && key !== "terrain";
      memory.set(memoryKey, labelKey ? clone(item.label || {}) : clone(item[key]));
    }
    clearTimeout(this.propTimer);

    if (base && layer === "country") {
      const patch = key === "name" || key === "terrain"
        ? { [key]: value }
        : { label: { ...(item.label || {}), [key]: value } };
      this.atlas.previewCountry(item.id, patch);
      if (key === "name" || key === "terrain") item[key] = value;
      else Object.assign(item.label, { [key]: value });
      if (final) {
        memory.delete(memoryKey);
        this.hooks.patchCountry(item.id, patch);
      } else {
        this.propTimer = setTimeout(() => this.applyProperty(key, value, true), 700);
      }
      return;
    }

    Object.assign(item, { [key]: value });
    this.scheduleRender(base);
    const write = () => {
      const before = memory.get(memoryKey);
      memory.delete(memoryKey);
      if (base) {
        this.hooks.patchBaseLabel(layer, item.id, { [key]: value });
        return;
      }
      const previous = clone(item);
      if (before === undefined) delete previous[key];
      else previous[key] = before;
      this.commit(
        [{ op: "update", layer, item: clone(item) }],
        `Правка: ${item.name || item.text || layer}`,
        [{ op: "update", layer, item: previous }],
        { silent: true }
      );
    };
    if (final) write();
    else this.propTimer = setTimeout(write, 700);
  }

  onPropertyInput() {
    // значения читаются прямо из элементов управления в renderSelection
  }

  scheduleRender(full = false) {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (full) this.atlas.render();
      else this.atlas.renderFeatures();
      this.atlas.setLayers(this.atlas.layers);
      this.atlas.applyPaintStyle();
      this.atlas.pick(this.selected);
      this.renderStatus();
    });
  }

  /* ── операции и отмена ────────────────────────────────────────────── */

  async commit(ops, label, inverse, { silent = false, record = true } = {}) {
    if (!ops.length) return false;
    this.busy = true;
    this.renderStatus();
    const ok = await this.hooks.applyOps(ops, silent ? null : label);
    this.busy = false;
    if (ok) {
      if (record) {
        this.undoStack.push({ ops, inverse, label });
        if (this.undoStack.length > 60) this.undoStack.shift();
        this.redoStack.length = 0;
      }
      this.atlas.renderFeatures();
      this.atlas.setLayers(this.atlas.layers);
      this.atlas.pick(this.selected);
    }
    this.renderStatus();
    return ok;
  }

  async undo() {
    const entry = this.undoStack.pop();
    if (!entry || this.busy) return;
    const ok = await this.commit(entry.inverse, null, null, { silent: true, record: false });
    if (ok) {
      this.redoStack.push(entry);
      toast(`Отменено: ${entry.label}`);
    } else this.undoStack.push(entry);
    this.renderStatus();
  }

  async redo() {
    const entry = this.redoStack.pop();
    if (!entry || this.busy) return;
    const ok = await this.commit(entry.ops, null, null, { silent: true, record: false });
    if (ok) {
      this.undoStack.push(entry);
      toast(`Возвращено: ${entry.label}`);
    } else this.redoStack.push(entry);
    this.renderStatus();
  }

  addOps(layer, items) {
    return {
      ops: items.map(item => ({ op: "add", layer, item })),
      inverse: items.map(item => ({ op: "remove", layer, id: item.id }))
    };
  }

  removeOps(refs) {
    const ops = [];
    const inverse = [];
    for (const ref of refs) {
      const [layer, id] = ref.split(":");
      const item = this.atlas.featureItem(ref);
      if (!item) continue;
      ops.push({ op: "remove", layer, id });
      inverse.push({ op: "add", layer, item: clone(item) });
    }
    return { ops, inverse };
  }

  /* ── указатель ────────────────────────────────────────────────────── */

  point(event) {
    const p = this.atlas.toMap(event.clientX, event.clientY);
    const { width, height } = this.atlas.size();
    return [Math.max(0, Math.min(width, p.x)), Math.max(0, Math.min(height, p.y))];
  }

  onHover(event) {
    if (!this.active) return;
    if (!event) return this.atlas.setBrush(null);
    const [x, y] = this.point(event);
    const s = this.settings[this.tool];
    if (this.tool === "icon") this.atlas.setBrush(x, y, s.single ? 7 : Math.max(5, (s.brush / 2) * s.jitter), "brush");
    else if (this.tool === "erase") this.atlas.setBrush(x, y, s.radius, "erase");
    else if (this.tool === "restore") this.atlas.setBrush(x, y, s.radius, "restore");
    else this.atlas.setBrush(null);
    if (this.draft) {
      this.draft.cursor = [x, y];
      this.paintDraft();
    }
    if (this.tool === "road" && this.roadFrom) {
      const city = this.hooks.world().cities.find(c => c.id === this.roadFrom);
      if (city) this.atlas.drawDraft({ points: [], link: [city.x, city.y, x, y] });
    }
  }

  /** Что под указателем: сначала узел SVG, затем поиск по координатам (знак мелкий, промах частый). */
  refAt(event, x, y) {
    const target = event.target.closest?.("[data-feature],[data-base-label],[data-country-label]");
    if (target) return target.dataset.feature || target.dataset.baseLabel || `country:${target.dataset.countryLabel}`;
    const tolerance = 10 / Math.max(0.5, this.atlas.view.k);
    return this.atlas.featureAt(x, y, tolerance) || this.atlas.baseLabelAt(x, y, tolerance);
  }

  onPointerDown(event) {
    if (!this.active || event.button === 2) return false;
    if (this.tool === "hand") return false;
    const [x, y] = this.point(event);

    if (this.tool === "icon") {
      this.beginStroke(x, y);
      return true;
    }
    if (this.tool === "erase") {
      this.beginErase(x, y);
      return true;
    }
    if (this.tool === "restore") {
      this.beginRestore(x, y);
      return true;
    }
    if (this.tool === "select") {
      const ref = this.refAt(event, x, y);
      if (!ref) return false;
      this.pick(ref);
      this.beginDrag(event, ref);
      return true;
    }
    return false;
  }

  onPointerMove(event) {
    if (!this.active) return false;
    const [x, y] = this.point(event);
    if (this.stroke) {
      this.moveStroke(x, y);
      return true;
    }
    if (this.erase) {
      this.moveErase(x, y);
      return true;
    }
    if (this.restore) {
      this.sweepRestore(x, y);
      return true;
    }
    if (this.drag) {
      this.moveDrag(x, y);
      return true;
    }
    return false;
  }

  onPointerUp() {
    if (!this.active) return false;
    if (this.stroke) {
      this.endStroke();
      return true;
    }
    if (this.erase) {
      this.endErase();
      return true;
    }
    if (this.restore) {
      this.endRestore();
      return true;
    }
    if (this.drag) {
      this.endDrag();
      return true;
    }
    return false;
  }

  onClick(event) {
    if (!this.active) return false;
    if (this.tool === "hand") return false;
    if (["icon", "erase", "restore"].includes(this.tool)) return true; // уже обработано кистью
    const [x, y] = this.point(event);
    if (["forest", "lake", "river"].includes(this.tool)) {
      this.addVertex(x, y);
      return true;
    }
    if (this.tool === "label") {
      this.createLabel(x, y);
      return true;
    }
    if (this.tool === "marker") {
      this.createMarker(x, y);
      return true;
    }
    if (this.tool === "city") {
      const s = this.settings.city;
      this.hooks.placeCity({ x, y }, { kind: s.kind, name: s.name });
      return true;
    }
    if (this.tool === "road") {
      const city = this.atlas.cityAt(x, y, 14);
      if (!city) {
        this.roadFrom = null;
        this.atlas.clearDraft();
        return true;
      }
      const id = city.id;
      if (!this.roadFrom) {
        this.roadFrom = id;
        toast(`Начало пути: ${city.name}. Щёлкните второй город.`);
        return true;
      }
      if (this.roadFrom !== id) {
        this.hooks.addRoad(this.roadFrom, id, this.settings.road.kind);
      }
      this.roadFrom = null;
      this.atlas.clearDraft();
      return true;
    }
    if (this.tool === "select") {
      if (!this.refAt(event, x, y)) this.clearPick();
      return false;
    }
    return false;
  }

  onDoubleClick() {
    if (!this.active) return false;
    if (this.draft) {
      this.finishDraft();
      return true;
    }
    return false;
  }

  onKey(event) {
    if (!this.active) return false;
    const tag = document.activeElement?.tagName || "";
    const typing = /input|textarea|select/i.test(tag);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return true;
    }
    if (typing) {
      if (event.key === "Enter" && this.draft) {
        event.preventDefault();
        this.finishDraft();
        return true;
      }
      return false;
    }
    if (event.key === "Enter" && this.draft) {
      event.preventDefault();
      this.finishDraft();
      return true;
    }
    if (event.key === "Backspace" && this.draft) {
      event.preventDefault();
      this.draft.points.pop();
      if (!this.draft.points.length) this.cancelDraft();
      else this.paintDraft();
      this.renderSelection();
      return true;
    }
    if (event.key === "Escape") {
      if (this.draft) {
        this.cancelDraft();
        return true;
      }
      if (this.selected) {
        this.clearPick();
        return true;
      }
      this.deactivate();
      return true;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && this.selected) {
      event.preventDefault();
      this.deleteSelected();
      return true;
    }
    const tool = TOOLS.find(t => t.key === event.key.toLowerCase());
    if (tool && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.setTool(tool.id);
      return true;
    }
    return false;
  }

  /* ── кисть знаков ─────────────────────────────────────────────────── */

  beginStroke(x, y) {
    const s = this.settings.icon;
    this.stroke = { items: [], last: null, spacing: Math.max(6, s.spacing) };
    this.dab(x, y, true);
  }

  dab(x, y, force = false) {
    const s = this.settings.icon;
    const stroke = this.stroke;
    if (!force && stroke.last && Math.hypot(x - stroke.last[0], y - stroke.last[1]) < stroke.spacing) return;
    stroke.last = [x, y];
    const count = s.single ? 1 : Math.max(1, Math.round(s.brush / Math.max(8, s.spacing)));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const reach = s.single ? 0 : Math.sqrt(Math.random()) * (s.brush / 2) * s.jitter;
      const px = Math.round((x + Math.cos(angle) * reach) * 10) / 10;
      const py = Math.round((y + Math.sin(angle) * reach) * 10) / 10;
      if (stroke.items.some(it => Math.hypot(it.x - px, it.y - py) < stroke.spacing * 0.55)) continue;
      const item = { id: uid("i"), type: s.type, x: px, y: py, size: +(s.size * (0.85 + Math.random() * 0.3)).toFixed(2) };
      stroke.items.push(item);
      const node = this.atlas.placeIcon(this.atlas.g.paintIcons, item.type, item.x, item.y, item.size, item.id, null);
      node.classList.add("pending");
      this.pending.push(node);
    }
    this.atlas.applyPaintStyle();
  }

  moveStroke(x, y) {
    this.dab(x, y);
  }

  async endStroke() {
    const stroke = this.stroke;
    this.stroke = null;
    for (const node of this.pending) node.remove();
    this.pending = [];
    this.atlas.setBrush(null);
    if (!stroke?.items.length) return;
    const { ops, inverse } = this.addOps("icons", stroke.items);
    await this.commit(ops, `Знаки: ${stroke.items.length}`, inverse, { silent: true });
  }

  /* ── ластик ───────────────────────────────────────────────────────── */

  beginErase(x, y) {
    this.erase = { refs: new Set(), hidden: new Map(), touched: [] };
    this.sweep(x, y);
  }

  sweep(x, y) {
    const s = this.settings.erase;
    const refs = this.atlas.featuresNear(x, y, s.radius).filter(ref => {
      if (!s.shapes && ["forests", "rivers", "lakes"].includes(ref.layer)) return false;
      return true;
    });
    for (const ref of refs) {
      const key = `${ref.layer}:${ref.id}`;
      if (this.erase.refs.has(key)) continue;
      this.erase.refs.add(key);
      for (const node of this.atlas.viewport.querySelectorAll(`[data-feature="${key}"]`)) {
        node.classList.add("erasing");
        this.erase.touched.push(node);
      }
    }
    if (s.base) {
      for (const icon of this.atlas.baseIconsNear(x, y, s.radius)) {
        if (this.erase.hidden.has(icon.key)) continue;
        this.erase.hidden.set(icon.key, { id: hiddenId(icon.x, icon.y), kind: "relief", x: icon.x, y: icon.y });
        const item = this.atlas.reliefByPoint.get(icon.key);
        if (item) {
          item.node.style.display = "none";
          this.erase.touched.push(item.node);
        }
      }
    }
    if (s.baseRivers) {
      for (const river of this.atlas.baseRiversNear(x, y, s.radius)) {
        const key = `river:${river.id}`;
        if (this.erase.hidden.has(key)) continue;
        this.erase.hidden.set(key, { id: `h-${river.id}`, kind: "river", ref: river.id, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
        river.node.style.display = "none";
        this.erase.touched.push(river.node);
      }
    }
  }

  /* ── возврат стёртой подложки ─────────────────────────────────────── */

  beginRestore(x, y) {
    this.restore = { ids: new Set(), touched: [] };
    this.sweepRestore(x, y);
  }

  sweepRestore(x, y) {
    const s = this.settings.restore;
    for (const item of this.atlas.features().hidden) {
      if (item.kind === "river" && !s.rivers) continue;
      if (item.kind !== "river" && !s.relief) continue;
      if (this.restore.ids.has(item.id)) continue;
      if (item.kind === "river") {
        const river = (this.atlas.baseRivers || []).find(r => r.id === item.ref);
        if (!river || !river.points.some(p => Math.hypot(p[0] - x, p[1] - y) <= s.radius + 4)) continue;
        river.node.style.display = "";
        this.restore.touched.push(river.node);
      } else {
        if (Math.hypot(item.x - x, item.y - y) > s.radius + 8) continue;
        const icon = this.atlas.reliefByPoint?.get(`${Number(item.x).toFixed(1)},${Number(item.y).toFixed(1)}`);
        if (icon) {
          icon.node.style.display = "";
          this.restore.touched.push(icon.node);
        }
      }
      this.restore.ids.add(item.id);
    }
  }

  async endRestore() {
    const state = this.restore;
    this.restore = null;
    this.atlas.setBrush(null);
    if (!state) return;
    if (!state.ids.size) {
      this.atlas.applyHidden(this.atlas.features().hidden);
      return;
    }
    const items = this.atlas.features().hidden.filter(h => state.ids.has(h.id));
    const ops = items.map(item => ({ op: "remove", layer: "hidden", id: item.id }));
    const inverse = items.map(item => ({ op: "add", layer: "hidden", item: clone(item) }));
    const ok = await this.commit(ops, `Возвращено: ${items.length}`, inverse, { silent: true });
    if (!ok) this.atlas.applyHidden(this.atlas.features().hidden);
  }

  moveErase(x, y) {
    this.sweep(x, y);
  }

  async endErase() {
    const state = this.erase;
    this.erase = null;
    this.atlas.setBrush(null);
    if (!state) return;
    const { ops, inverse } = this.removeOps([...state.refs]);
    const hidden = [...state.hidden.values()];
    const existing = new Set(this.atlas.features().hidden.map(h => h.id));
    const fresh = hidden.filter(h => !existing.has(h.id));
    const add = this.addOps("hidden", fresh);
    const all = [...ops, ...add.ops];
    const back = [...inverse, ...add.inverse];
    if (!all.length) {
      this.atlas.renderFeatures();
      this.atlas.applyHidden(this.atlas.features().hidden);
      return;
    }
    const ok = await this.commit(all, `Ластик: ${state.refs.size + fresh.length}`, back, { silent: true });
    if (!ok) {
      this.atlas.renderFeatures();
      this.atlas.applyHidden(this.atlas.features().hidden);
    }
  }

  /* ── контуры: лес, озеро, река ────────────────────────────────────── */

  minPoints() {
    return this.draft?.kind === "river" ? 2 : 3;
  }

  addVertex(x, y) {
    const kind = this.tool;
    if (!this.draft) this.draft = { kind, points: [], cursor: [x, y] };
    const points = this.draft.points;
    if (points.length && Math.hypot(points.at(-1)[0] - x, points.at(-1)[1] - y) < 2) return;
    points.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    this.paintDraft();
    this.renderSelection();
  }

  paintDraft() {
    if (!this.draft) return;
    const points = this.draft.points.slice();
    if (this.draft.cursor) points.push(this.draft.cursor);
    this.atlas.drawDraft({ kind: this.draft.kind, points });
  }

  cancelDraft() {
    this.draft = null;
    this.atlas.clearDraft();
    if (this.active) this.renderSelection();
  }

  async finishDraft() {
    const draft = this.draft;
    if (!draft || draft.points.length < this.minPoints()) {
      toast(`Нужно минимум ${this.minPoints()} точки`, "bad");
      return;
    }
    const s = this.settings[draft.kind];
    const points = simplify(draft.points, draft.kind === "river" ? 1.2 : 2);
    let layer;
    let item;
    if (draft.kind === "river") {
      layer = "rivers";
      item = { id: uid("r"), name: s.name || "", points, width: s.width };
    } else if (draft.kind === "lake") {
      layer = "lakes";
      item = { id: uid("l"), name: s.name || "", points };
    } else {
      layer = "forests";
      item = { id: uid("f"), name: s.name || "", kind: s.kind, points, density: s.density };
    }
    this.draft = null;
    this.atlas.clearDraft();
    const { ops, inverse } = this.addOps(layer, [item]);
    const ok = await this.commit(ops, `${layer === "rivers" ? "Река" : layer === "lakes" ? "Озеро" : "Лес"} на карте`, inverse);
    if (ok) {
      this.pick(`${layer}:${item.id}`);
      $("#editorSelection input[type=text]")?.focus();
      this.setToolSoft("select");
    }
  }

  /** После завершения контура переходим к выбору, но не сбрасываем только что выбранное. */
  setToolSoft(id) {
    this.tool = id;
    $$("#editorRail .tool-btn").forEach(b => b.classList.toggle("active", b.dataset.tool === id));
    const tool = TOOLS.find(t => t.id === id);
    $("#editorToolName").textContent = tool.name;
    $("#editorToolHint").textContent = tool.hint;
    $("#atlas").dataset.tool = id;
    this.renderControls();
    this.renderSelection();
  }

  /* ── точечные объекты ─────────────────────────────────────────────── */

  async createLabel(x, y) {
    const s = this.settings.label;
    const item = {
      id: uid("t"), text: (s.text || "Новая надпись").slice(0, 120), kind: s.kind,
      x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, size: s.size, rotate: s.rotate
    };
    const { ops, inverse } = this.addOps("labels", [item]);
    if (await this.commit(ops, `Надпись «${item.text}»`, inverse)) {
      this.pick(`labels:${item.id}`);
      this.setToolSoft("select");
      $("#editorSelection input[type=text]")?.focus();
      $("#editorSelection input[type=text]")?.select();
    }
  }

  async createMarker(x, y) {
    const s = this.settings.marker;
    const item = { id: uid("m"), kind: s.kind, name: s.name || "", x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    const { ops, inverse } = this.addOps("markers", [item]);
    if (await this.commit(ops, `Метка «${item.name || "без имени"}»`, inverse)) {
      this.pick(`markers:${item.id}`);
      this.setToolSoft("select");
    }
  }

  async deleteSelected() {
    const found = this.selectionItem();
    if (!found || found.base) return;
    const { ops, inverse } = this.removeOps([this.selected]);
    const label = found.item.name || found.item.text || "объект";
    this.clearPick();
    await this.commit(ops, `Удалено: ${label}`, inverse);
  }

  async duplicateSelected() {
    const found = this.selectionItem();
    if (!found || found.base) return;
    const copy = clone(found.item);
    copy.id = uid(found.layer.slice(0, 1));
    if (copy.points) copy.points = copy.points.map(([x, y]) => [x + 18, y + 18]);
    else {
      copy.x = (copy.x ?? 0) + 18;
      copy.y = (copy.y ?? 0) + 18;
    }
    const { ops, inverse } = this.addOps(found.layer, [copy]);
    if (await this.commit(ops, "Копия объекта", inverse)) this.pick(`${found.layer}:${copy.id}`);
  }

  /* ── перенос объектов ─────────────────────────────────────────────── */

  beginDrag(event, ref) {
    const selector = ref.startsWith("country:")
      ? `[data-country-label="${ref.split(":")[1]}"]`
      : `[data-feature="${ref}"],[data-base-label="${ref}"]`;
    const nodes = [...this.atlas.viewport.querySelectorAll(selector)];
    if (!nodes.length) return;
    const start = this.point(event);
    this.drag = {
      ref,
      start,
      moved: false,
      nodes: nodes.map(node => ({ node, transform: node.getAttribute("transform") || "" }))
    };
  }

  moveDrag(x, y) {
    const dx = x - this.drag.start[0];
    const dy = y - this.drag.start[1];
    if (Math.hypot(dx, dy) > 1.5) this.drag.moved = true;
    this.drag.dx = dx;
    this.drag.dy = dy;
    for (const entry of this.drag.nodes) {
      entry.node.setAttribute("transform", `translate(${dx.toFixed(1)},${dy.toFixed(1)}) ${entry.transform}`);
    }
    this.atlas.pick(this.drag.ref);
  }

  async endDrag() {
    const drag = this.drag;
    this.drag = null;
    for (const entry of drag.nodes) entry.node.setAttribute("transform", entry.transform);
    if (!drag.moved) {
      this.atlas.pick(drag.ref);
      return;
    }
    const dx = Math.round((drag.dx || 0) * 10) / 10;
    const dy = Math.round((drag.dy || 0) * 10) / 10;
    const found = this.selectionItem();
    if (!found?.item) return;
    const { layer, item, base } = found;
    const shift = value => ({
      ...value,
      ...(value.points ? { points: value.points.map(([x, y]) => [Math.round((x + dx) * 10) / 10, Math.round((y + dy) * 10) / 10]) } : {}),
      ...(value.x !== undefined ? { x: Math.round((value.x + dx) * 10) / 10 } : {}),
      ...(value.y !== undefined ? { y: Math.round((value.y + dy) * 10) / 10 } : {})
    });
    if (base) {
      if (layer === "country") {
        const label = { ...(item.label || {}), x: (item.label?.x ?? 0) + dx, y: (item.label?.y ?? 0) + dy };
        await this.hooks.patchCountry(item.id, { label });
      } else {
        await this.hooks.patchBaseLabel(layer, item.id, { x: (item.x ?? 0) + dx, y: (item.y ?? 0) + dy });
      }
      this.atlas.pick(this.selected);
      return;
    }
    const before = clone(item);
    const next = shift(item);
    const { width, height } = this.atlas.size();
    if (next.x !== undefined) next.x = Math.max(0, Math.min(width, next.x));
    if (next.y !== undefined) next.y = Math.max(0, Math.min(height, next.y));
    await this.commit(
      [{ op: "update", layer, item: next }],
      "Перенос объекта",
      [{ op: "update", layer, item: before }],
      { silent: true }
    );
    this.atlas.pick(this.selected);
  }
}

export { TOOLS };