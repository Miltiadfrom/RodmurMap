import { $, $$, esc, num, people, debounce, toast, slug } from "./util.js";
import { api, setCsrf } from "./api.js";
import { Atlas, cityTooltip, countryTooltip } from "./atlas.js";
import { renderLands, renderCities, renderFilters, renderDetail, readForm, visibleCities } from "./panels.js";
import { MapEditor } from "./editor.js";

const DEFAULT_APPEARANCE = {
  reliefSet: "illustrated",
  reliefScale: 1,
  reliefDensity: 1,
  reliefInk: 1,
  tint: 26,
  biomes: true,
  texture: true,
  layers: { tint: true, grid: false, roads: true, seas: true, hydro: true, landLabels: true, cities: true, cityLabels: true }
};

const clone = value => JSON.parse(JSON.stringify(value));
const mergeAppearance = saved => ({
  ...clone(DEFAULT_APPEARANCE),
  ...(saved || {}),
  layers: { ...DEFAULT_APPEARANCE.layers, ...(saved?.layers || {}) }
});

const state = {
  world: null,
  session: { admin: false, csrf: null },
  selection: null,
  mode: "view",
  filter: "all",
  landFocus: null,
  query: "",
  appearance: clone(DEFAULT_APPEARANCE),
  savedAppearance: clone(DEFAULT_APPEARANCE),
  draftCity: null
};

let atlas;
let editor;
let appearanceFrame = 0;
let reliefDirty = false;

/* ── отрисовка оболочек ─────────────────────────────────────────────── */

function paintSidebar() {
  const peek = selection => atlas.setPeek(selection);
  renderLands(state, selection => select(selection), peek, id => {
    select({ type: "country", id }, { fly: false });
    state.mode = "edit";
    renderDetail(state, "edit");
    $("#detailBody").querySelector("input")?.focus();
  });
  renderFilters(state, value => {
    state.filter = value;
    refresh();
  });
  renderCities(state, selection => select(selection), peek);
}

function paintStats() {
  const w = state.world;
  const pop = w.countries.reduce((sum, c) => sum + c.population, 0);
  const km = w.roads.reduce((sum, r) => sum + r.length, 0);
  $("#statLine").innerHTML =
    `<b>${w.countries.length}</b> земель · <b>${w.cities.length}</b> поселений · <b>${w.roads.length}</b> путей<br>` +
    `Население Родмура: <b>${esc(people(pop))}</b> человек<br>` +
    `Дороги и переходы: <b>${num(km)}</b> км<br>` +
    `<span class="rev">Правка ${num(w.meta.revision)} · ${new Date(w.meta.updatedAt).toLocaleDateString("ru-RU")}</span>`;
}

function paintHeader() {
  const meta = state.world.meta;
  $("#atlasTitle").textContent = meta.title;
  $("#atlasSubtitle").textContent = meta.subtitle;
  $("#era").textContent = meta.era;
  $("#intro").textContent = meta.intro;
  document.title = `${meta.title} — ${meta.subtitle}`;
}

function refresh() {
  const shown = visibleCities(state);
  const ids = new Set(shown.map(c => c.id));
  paintSidebar();
  renderDetail(state, state.mode);
  atlas.setPeek(null);
  atlas.filterCities(city => ids.has(city.id));
  atlas.highlight(state.query.trim() ? ids : null);
}

/** Слои, краски и бумага — дешёвые ручки, применяются сразу. */
function applyPaper() {
  const a = state.appearance;
  atlas.setLayers(a.layers);
  atlas.setTint(a.tint);
  atlas.setBaseLayer("biomes", a.biomes);
  atlas.setBaseLayer("texture", a.texture);
}

function applyRelief() {
  const a = state.appearance;
  atlas.setRelief({ set: a.reliefSet, scale: a.reliefScale, density: a.reliefDensity, ink: a.reliefInk });
}

function applyAppearance() {
  applyPaper();
  applyRelief();
  atlas.select(state.selection);
  syncStyleControls();
  reliefDirty = false;
}

/** Ползунки двигаются чаще, чем нужно перерисовывать 3500 знаков рельефа:
    бумагу и слои меняем немедленно, рельеф — не чаще одного раза за кадр. */
function scheduleAppearance(relief = false) {
  applyPaper();
  syncStyleControls();
  if (!relief) return;
  reliefDirty = true;
  if (appearanceFrame) return;
  appearanceFrame = requestAnimationFrame(() => {
    appearanceFrame = 0;
    if (!reliefDirty) return;
    applyRelief();
    reliefDirty = false;
  });
}

function applyWorld(world) {
  state.world = world;
  state.savedAppearance = mergeAppearance(world.meta.appearance);
  atlas.setWorld(world);
  applyAppearance();
  paintHeader();
  paintStats();
  refresh();
}

function syncStyleControls() {
  const a = state.appearance;
  $("#reliefSet").value = a.reliefSet;
  // Насыщенность земель хранится целым процентом (0–60), рельеф — долей от исходного.
  $("#tintStrength").value = String(a.tint);
  $("#tintValue").textContent = `${Math.round(a.tint)}%`;
  const values = [
    ["#reliefScale", "#reliefScaleValue", a.reliefScale],
    ["#reliefDensity", "#reliefDensityValue", a.reliefDensity],
    ["#reliefInk", "#reliefInkValue", a.reliefInk]
  ];
  for (const [input, output, value] of values) {
    $(input).value = String(Math.round(value * 100));
    $(output).textContent = `${Math.round(value * 100)}%`;
  }
  $$("#layerGrid input[data-layer]").forEach(input => (input.checked = Boolean(a.layers[input.dataset.layer])));
  $$("#paperGrid input[data-paper]").forEach(input => (input.checked = Boolean(a[input.dataset.paper])));
  const dirty = JSON.stringify(a) !== JSON.stringify(state.savedAppearance);
  $("#styleSave").classList.toggle("pulse", dirty);
  $("#styleReset").disabled = !dirty;
}

/* ── выбор объекта ──────────────────────────────────────────────────── */

/** Убрать несохранённый показ правки земли. */
function clearPreview() {
  if (state.mode === "edit" && state.selection?.type === "country") atlas.previewCountry(state.selection.id, {});
}

function select(selection, { fly = true } = {}) {
  clearPreview();
  state.selection = selection;
  state.mode = "view";
  atlas.select(selection);
  renderDetail(state, "view");
  paintSidebar();
  if (window.innerWidth <= 980) $("#sidebar").classList.remove("open");
  if (!fly) return;
  if (selection.type === "country") {
    const country = state.world.countries.find(c => c.id === selection.id);
    if (country?.label) atlas.flyTo(country.label.x, country.label.y, 2.6);
  } else {
    const city = state.world.cities.find(c => c.id === selection.id);
    if (city) atlas.flyTo(city.x, city.y, Math.max(atlas.view.k, 5));
  }
}

function closeDetail() {
  clearPreview();
  state.selection = null;
  state.mode = "view";
  state.draftCity = null;
  atlas.select(null);
  renderDetail(state, "view");
  paintSidebar();
}

/* ── сессия хранителя ───────────────────────────────────────────────── */

function paintSession() {
  const admin = state.session.admin;
  document.body.classList.toggle("keeper", admin);
  $("#keeperBtnLabel").textContent = admin ? "Хранитель" : "Вход хранителя";
  $("#keeperBtn").classList.toggle("on", admin);
  $("#keeperBtn").title = admin ? "Панель хранителя" : "Вход для хранителя атласа";
  $("#addCityBtn").hidden = !admin;
  $("#editorBtn").hidden = !admin;
  if (!admin) editor?.deactivate();
  atlas?.setAdmin(admin);
  if (!admin && state.mode !== "view") {
    state.mode = "view";
    renderDetail(state, "view");
  }
}

async function loadSession() {
  state.session = await api.session();
  setCsrf(state.session.csrf);
  paintSession();
}

async function mutate(promise, message) {
  try {
    const result = await promise;
    if (result.world) applyWorld(result.world);
    if (message) toast(message, "good");
    return result;
  } catch (error) {
    if (/вход хранителя|Сессия|CSRF/i.test(error.message)) {
      state.session = { admin: false, csrf: null };
      setCsrf(null);
      paintSession();
      openLogin();
    }
    toast(error.message, "bad");
    return null;
  }
}

/* ── модальные окна ─────────────────────────────────────────────────── */

function openModal(selector) {
  const dialog = $(selector);
  if (!dialog.open) dialog.showModal();
  dialog.querySelector("input:not([hidden]),select,textarea")?.focus();
}

function closeModal(selector) {
  const dialog = $(selector);
  if (dialog?.open) dialog.close();
}

const openLogin = () => {
  $("#loginError").hidden = true;
  $("#password").value = "";
  openModal("#loginModal");
};

const anyModalOpen = () => $$(".modal").some(dialog => dialog.open);

/* ── верхняя панель ─────────────────────────────────────────────────── */

function wireTopbar() {
  const search = $("#search");
  search.addEventListener("input", debounce(() => {
    state.query = search.value;
    state.landFocus = null;
    refresh();
  }, 140));
  search.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    const term = search.value.trim().toLowerCase();
    if (!term) return;
    const list = visibleCities(state);
    if (list.length) return select({ type: "city", id: list[0].id });
    const country = state.world.countries.find(c => `${c.name} ${c.fullName}`.toLowerCase().includes(term));
    if (country) select({ type: "country", id: country.id });
    else toast("Ничего не найдено", "bad");
  });

  const panel = $("#layersPop");
  const setPanel = open => {
    panel.hidden = !open;
    $("#layersBtn").setAttribute("aria-expanded", String(open));
    $("#layersBtn").classList.toggle("on", open);
    document.body.classList.toggle("style-open", open);
  };
  $("#layersBtn").addEventListener("click", () => setPanel(panel.hidden));
  $("#closeStyle").addEventListener("click", () => setPanel(false));

  const grid = $("#layerGrid");
  const entries = [
    ["tint", "Земли"], ["roads", "Пути"], ["cities", "Поселения"], ["cityLabels", "Названия"],
    ["landLabels", "Подписи и надписи"], ["hydro", "Реки, горы, леса"], ["seas", "Моря"], ["grid", "Сетка"]
  ];
  grid.replaceChildren();
  for (const [key, label] of entries) {
    const wrap = document.createElement("label");
    wrap.className = "switch";
    wrap.innerHTML = `<input type="checkbox" data-layer="${key}" ${state.appearance.layers[key] ? "checked" : ""} /><span></span>${esc(label)}`;
    wrap.querySelector("input").addEventListener("change", event => {
      state.appearance.layers[key] = event.target.checked;
      scheduleAppearance();
    });
    grid.append(wrap);
  }

  const paper = $("#paperGrid");
  paper.replaceChildren();
  for (const [key, label] of [["biomes", "Растительность"], ["texture", "Фактура бумаги"]]) {
    const wrap = document.createElement("label");
    wrap.className = "switch";
    wrap.innerHTML = `<input type="checkbox" data-paper="${key}" ${state.appearance[key] ? "checked" : ""} /><span></span>${esc(label)}`;
    wrap.querySelector("input").addEventListener("change", event => {
      state.appearance[key] = event.target.checked;
      scheduleAppearance();
    });
    paper.append(wrap);
  }

  const ranges = [
    ["#tintStrength", "#tintValue", "tint", value => Math.round(value), value => `${Math.round(value)}%`, false],
    ["#reliefScale", "#reliefScaleValue", "reliefScale", value => value / 100, value => `${Math.round(value * 100)}%`, true],
    ["#reliefDensity", "#reliefDensityValue", "reliefDensity", value => value / 100, value => `${Math.round(value * 100)}%`, true],
    ["#reliefInk", "#reliefInkValue", "reliefInk", value => value / 100, value => `${Math.round(value * 100)}%`, true]
  ];
  for (const [input, output, key, read, show, heavy] of ranges) {
    $(input).addEventListener("input", event => {
      state.appearance[key] = read(Number(event.target.value));
      $(output).textContent = show(state.appearance[key]);
      scheduleAppearance(heavy);
    });
  }
  $("#reliefSet").addEventListener("change", event => {
    state.appearance.reliefSet = event.target.value;
    scheduleAppearance(true);
  });

  $("#styleReset").addEventListener("click", () => {
    state.appearance = clone(state.savedAppearance);
    syncStyleControls();
    applyAppearance();
    toast("Оформление возвращено к сохранённому");
  });

  $("#styleSave").addEventListener("click", async () => {
    if (!state.session.admin) return openLogin();
    await mutate(api.patchMeta({ appearance: state.appearance }), "Оформление сохранено для всех посетителей");
    syncStyleControls();
  });

  $("#keeperBtn").addEventListener("click", () => (state.session.admin ? openKeeper() : openLogin()));
  $("#toggleSidebar").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#closeSidebar").addEventListener("click", () => $("#sidebar").classList.remove("open"));

  $("#zoomIn").addEventListener("click", () => atlas.zoomBy(1.5));
  $("#zoomOut").addEventListener("click", () => atlas.zoomBy(1 / 1.5));
  $("#zoomFit").addEventListener("click", () => {
    closeDetail();
    atlas.fit();
  });

  document.addEventListener("keydown", event => {
    if (editor?.onKey(event)) return;
    const tag = document.activeElement?.tagName || "";
    if (event.key === "/" && !/input|textarea|select/i.test(tag)) {
      event.preventDefault();
      search.focus();
      search.select();
      return;
    }
    if (event.key !== "Escape" || anyModalOpen()) return;
    if (atlas.placing) return cancelPlacing();
    if (!$("#layersPop").hidden) return void $("#closeStyle").click();
    if (!$("#detail").hidden) closeDetail();
  });
}

/* ── панель сведений ────────────────────────────────────────────────── */

function wireDetail() {
  $("#detailClose").addEventListener("click", closeDetail);

  $("#detailBody").addEventListener("click", async event => {
    const gotoCity = event.target.closest("[data-goto-city]");
    if (gotoCity) return select({ type: "city", id: gotoCity.dataset.gotoCity });
    const gotoCountry = event.target.closest("[data-goto-country]");
    if (gotoCountry) return select({ type: "country", id: gotoCountry.dataset.gotoCountry });

    const delRoad = event.target.closest("[data-del-road]");
    if (delRoad) {
      if (!confirm("Убрать этот путь из атласа?")) return;
      const snapshot = state.world;
      if (await mutate(api.removeRoad(delRoad.dataset.delRoad))) {
        toast("Путь убран", "", { label: "Вернуть", onClick: () => mutate(api.replaceWorld(snapshot), "Путь возвращён") });
      }
      return;
    }

    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    const selection = state.selection;

    if (action === "zoom-country") {
      const country = state.world.countries.find(c => c.id === selection.id);
      if (country?.label) atlas.flyTo(country.label.x, country.label.y, 2.6);
      return;
    }
    if (action === "zoom-city") {
      const city = state.world.cities.find(c => c.id === selection.id);
      if (city) atlas.flyTo(city.x, city.y, 8);
      return;
    }
    if (action === "edit-country" || action === "edit-city") {
      state.mode = "edit";
      renderDetail(state, "edit");
      return;
    }
    if (action === "cancel-edit") {
      clearPreview();
      state.mode = "view";
      state.draftCity = null;
      renderDetail(state, state.selection ? "view" : "view");
      return;
    }
    if (action === "delete-city") {
      const city = state.world.cities.find(c => c.id === selection.id);
      if (!city || !confirm(`Удалить поселение «${city.name}»? Связанные пути тоже будут удалены.`)) return;
      const snapshot = state.world;
      closeDetail();
      if (await mutate(api.removeCity(city.id))) {
        toast(`Поселение «${city.name}» удалено`, "", {
          label: "Вернуть",
          onClick: () => mutate(api.replaceWorld(snapshot), `Поселение «${city.name}» возвращено`)
        });
      }
    }
  });

  $("#detailBody").addEventListener("input", event => {
    const form = event.target.closest("#editForm");
    if (!form) return;
    if (form.dataset.kind === "country") {
      // живой показ: имя, цвет и подпись земли едут по карте прямо во время набора
      const label = {};
      for (const key of ["x", "y", "rotate", "size"]) {
        const value = Number(form.elements[`label.${key}`]?.value);
        if (Number.isFinite(value)) label[key] = value;
      }
      atlas.previewCountry(form.dataset.id, {
        name: form.elements.name.value,
        color: form.elements.color.value,
        terrain: form.elements.terrain?.value ?? "",
        label
      });
      return;
    }
    if (form.dataset.id || event.target.name !== "name") return;
    const idField = form.elements.id;
    if (idField && !idField.dataset.touched) idField.value = slug(event.target.value);
  });
  $("#detailBody").addEventListener("change", event => {
    if (event.target.name === "id") event.target.dataset.touched = "1";
  });

  $("#detailBody").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    // У формы поле name="id" перекрывает form.id (LegacyOverrideBuiltIns) — сверяем селектором.
    if (form.matches("#roadForm")) {
      const data = Object.fromEntries(new FormData(form).entries());
      await mutate(api.addRoad({ from: form.dataset.from, to: data.to, kind: data.kind }), "Путь проложен");
      return;
    }
    if (!form.matches("#editForm")) return;

    const data = readForm(form);
    const error = form.querySelector(".error");
    error.hidden = true;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      if (form.dataset.kind === "country") {
        if (await mutate(api.patchCountry(form.dataset.id, data), "Земля обновлена")) {
          state.mode = "view";
          renderDetail(state, "view");
        }
      } else if (form.dataset.id) {
        if (await mutate(api.patchCity(form.dataset.id, data), "Поселение обновлено")) {
          state.mode = "view";
          renderDetail(state, "view");
        }
      } else {
        const before = new Set(state.world.cities.map(c => c.id));
        const result = await api.addCity(data);
        applyWorld(result.world);
        const created = result.world.cities.find(c => !before.has(c.id));
        state.draftCity = null;
        state.mode = "view";
        if (created) select({ type: "city", id: created.id }, { fly: false });
        toast(`Поселение «${data.name}» добавлено`, "good");
      }
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}

/* ── постановка нового города ───────────────────────────────────────── */

function startPlacing() {
  if (!state.session.admin) return openLogin();
  atlas.startPlacing();
  $("#placeMode").hidden = false;
  $("#sidebar").classList.remove("open");
}

function cancelPlacing() {
  atlas.stopPlacing();
  $("#placeMode").hidden = true;
}

function wirePlacing() {
  $("#addCityBtn").addEventListener("click", startPlacing);
  $("#cancelPlace").addEventListener("click", cancelPlacing);
}

/* ── редактор карты ─────────────────────────────────────────────────── */

function wireEditor() {
  editor = new MapEditor(atlas, {
    world: () => state.world,
    applyOps: async (ops, message) => Boolean(await mutate(api.features(ops), message)),
    patchBaseLabel: async (kind, id, patch) => Boolean(await mutate(api.patchBaseLabel(kind, id, patch))),
    patchCountry: async (id, patch) => Boolean(await mutate(api.patchCountry(id, patch))),
    addRoad: async (from, to, kind) => {
      const exists = state.world.roads.some(r => (r.from === from && r.to === to) || (r.from === to && r.to === from));
      if (exists) return toast("Эти города уже связаны путём", "bad");
      await mutate(api.addRoad({ from, to, kind }), "Путь проложен");
    },
    placeCity: (point, preset) => {
      state.selection = null;
      state.mode = "new-city";
      state.draftCity = {
        id: "", name: preset.name || "", kind: preset.kind || "town", country: nearestCountry(point),
        population: 1200, founded: 1000, ruler: "", summary: "", description: "", notables: [],
        x: +point.x.toFixed(1), y: +point.y.toFixed(1), port: false
      };
      renderDetail(state, "new-city");
      $("#detailBody").querySelector("input")?.focus();
    },
    openSelection: ref => {
      const [layer, id] = String(ref).split(":");
      if (layer === "country") select({ type: "country", id }, { fly: false });
    },
    onExit: () => {
      state.mode = "view";
      renderDetail(state, "view");
    }
  });
  $("#editorBtn").addEventListener("click", () => {
    if (!state.session.admin) return openLogin();
    if (editor.active) editor.deactivate();
    else {
      closeDetail();
      $("#layersPop").hidden = true;
      document.body.classList.remove("style-open");
      $("#layersBtn").classList.remove("on");
      editor.activate();
    }
    $("#editorBtn").setAttribute("aria-pressed", String(editor.active));
  });
}

/** Новый город по умолчанию принадлежит земле, чей контур ближе всего. */
function nearestCountry(point) {
  let best = state.world.countries[0].id;
  let bestDistance = Infinity;
  for (const country of state.world.countries) {
    const label = country.label || { x: 0, y: 0 };
    const distance = Math.hypot(label.x - point.x, label.y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = country.id;
    }
  }
  return best;
}

/* ── панель хранителя ───────────────────────────────────────────────── */

async function openKeeper() {
  const meta = state.world.meta;
  const form = $("#metaForm");
  form.elements.title.value = meta.title;
  form.elements.subtitle.value = meta.subtitle;
  form.elements.era.value = meta.era;
  form.elements.intro.value = meta.intro;
  openModal("#keeperModal");

  const list = $("#historyList");
  list.innerHTML = `<p class="muted">Читаем летопись правок…</p>`;
  try {
    const { history } = await api.history();
    list.replaceChildren();
    if (!history.length) {
      list.innerHTML = `<p class="muted">Правок пока не было — атлас в исходном виде.</p>`;
      return;
    }
    for (const entry of history) {
      const row = document.createElement("div");
      row.className = "history-row";
      row.innerHTML =
        `<b>r${entry.revision}</b>` +
        `<span>${entry.updatedAt ? new Date(entry.updatedAt).toLocaleString("ru-RU") : "исходная версия"}<br>` +
        `<small>${entry.countries} земель · ${entry.cities} поселений</small></span>`;
      const button = document.createElement("button");
      button.className = "mini-btn";
      button.textContent = "Откатить";
      button.addEventListener("click", async () => {
        if (!confirm(`Вернуть атлас к правке r${entry.revision}? Текущее состояние сохранится в истории.`)) return;
        if (await mutate(api.restore(entry.file), `Атлас возвращён к правке r${entry.revision}`)) openKeeper();
      });
      row.append(button);
      list.append(row);
    }
  } catch (error) {
    list.innerHTML = `<p class="error">${esc(error.message)}</p>`;
  }
}

function wireKeeper() {
  $$("#keeperModal .keeper-tabs .tab").forEach(button => {
    button.addEventListener("click", () => {
      $$("#keeperModal .keeper-tabs .tab").forEach(b => b.classList.toggle("active", b === button));
      $$("#keeperModal .tab-body").forEach(panel => (panel.hidden = panel.dataset.panel !== button.dataset.tab));
    });
  });

  $("#loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    const error = $("#loginError");
    error.hidden = true;
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      state.session = await api.login($("#password").value);
      setCsrf(state.session.csrf);
      paintSession();
      closeModal("#loginModal");
      toast("Вы вошли как хранитель атласа", "good");
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });

  $("#metaForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    const error = form.querySelector(".error");
    error.hidden = true;
    try {
      await mutate(api.patchMeta(Object.fromEntries(new FormData(form).entries())), "Титул атласа обновлён");
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });

  $("#passwordForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    const error = form.querySelector(".error");
    error.hidden = true;
    const result = await mutate(
      api.changePassword(form.elements.current.value, form.elements.next.value),
      "Пароль хранителя обновлён"
    );
    if (result) form.reset();
    else {
      error.textContent = "Не удалось сменить пароль: проверьте текущий пароль (новый — от 8 символов).";
      error.hidden = false;
    }
  });

  $("#importFile").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!confirm(`Заменить весь атлас данными из «${file.name}»? Текущее состояние сохранится в истории.`)) return;
      if (await mutate(api.replaceWorld(parsed), "Атлас заменён")) closeModal("#keeperModal");
    } catch (err) {
      toast(err.message, "bad");
    } finally {
      event.target.value = "";
    }
  });

  $("#logoutBtn").addEventListener("click", async () => {
    await api.logout().catch(() => {});
    state.session = { admin: false, csrf: null };
    setCsrf(null);
    paintSession();
    closeModal("#keeperModal");
    closeDetail();
    $("#editorBtn").setAttribute("aria-pressed", "false");
    toast("Вы вышли из режима хранителя");
  });

  $$("[data-close]").forEach(button => {
    button.addEventListener("click", () => closeModal(`#${button.closest(".modal").id}`));
  });
  $$(".modal").forEach(dialog => {
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });
  });
}

/* ── обратные вызовы карты ──────────────────────────────────────────── */

function wireAtlas() {
  atlas.handlers.select = selection => {
    if (!selection) return closeDetail();
    select(selection, { fly: false });
  };

  atlas.handlers.hover = (event, selection) => {
    const tip = $("#tooltip");
    if (editor?.active && editor.tool !== "select") selection = null; // в режиме правки подсказки мешают кисти
    if (!selection) {
      tip.hidden = true;
      return;
    }
    const html = selection.type === "city"
      ? cityTooltip(state.world.cities.find(c => c.id === selection.id))
      : countryTooltip(state.world.countries.find(c => c.id === selection.id));
    if (!html) return;
    tip.innerHTML = html;
    tip.hidden = false;
    const wrap = $("#mapWrap").getBoundingClientRect();
    const x = Math.min(event.clientX - wrap.left + 16, wrap.width - tip.offsetWidth - 10);
    const y = Math.min(event.clientY - wrap.top + 16, wrap.height - tip.offsetHeight - 10);
    tip.style.left = `${Math.max(6, x)}px`;
    tip.style.top = `${Math.max(6, y)}px`;
  };

  atlas.handlers.zoom = view => {
    if (!state.world) return;
    const pxPerKm = (atlas.baseScale() * view.k) / state.world.meta.map.kmPerPx;
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    const ideal = 92 / pxPerKm;
    const km = steps.reduce((best, s) => (Math.abs(s - ideal) < Math.abs(best - ideal) ? s : best), steps[0]);
    $("#scaleBar").style.width = `${Math.max(18, Math.round(km * pxPerKm))}px`;
    $("#scaleLabel").textContent = `${num(km)} км`;
  };

  atlas.handlers.interact = () => {
    $("#hint").classList.add("gone");
    $("#tooltip").hidden = true;
  };
  atlas.handlers.resize = view => atlas.handlers.zoom(view);

  atlas.handlers.place = point => {
    cancelPlacing();
    state.selection = null;
    state.mode = "new-city";
    state.draftCity = {
      id: "", name: "", kind: "town", country: state.world.countries[0].id,
      population: 1200, founded: 1000, ruler: "", summary: "", description: "", notables: [],
      x: +point.x.toFixed(1), y: +point.y.toFixed(1), port: false
    };
    renderDetail(state, "new-city");
    $("#detailBody").querySelector("input")?.focus();
  };

  atlas.handlers.moveCity = async (id, x, y) => {
    const city = state.world.cities.find(c => c.id === id);
    await mutate(api.patchCity(id, { x, y }), `«${city?.name ?? id}» перенесён`);
  };
}

/* ── запуск ─────────────────────────────────────────────────────────── */

async function boot() {
  atlas = new Atlas($("#atlas"));
  wireTopbar();
  wireDetail();
  wirePlacing();
  wireKeeper();
  wireAtlas();
  wireEditor();

  try {
    const [world] = await Promise.all([api.world(), loadSession()]);
    await atlas.init(world.meta.map.file);
    state.appearance = mergeAppearance(world.meta.appearance);
    applyWorld(world);
    $("#loading").hidden = true;
    setTimeout(() => $("#hint").classList.add("gone"), 9000);
  } catch (error) {
    $("#loading").innerHTML = `<p class="error">Не удалось загрузить атлас: ${esc(error.message)}</p>`;
  }
}

boot();
