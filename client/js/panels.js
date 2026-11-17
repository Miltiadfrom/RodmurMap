import { $, esc, num, people, area, KINDS, TERRAINS, ROAD_KINDS } from "./util.js";

const KIND_ICON = {
  capital: '<circle cx="7" cy="7" r="5" fill="#c99a45" stroke="#2b2318" stroke-width="1.1"/><circle cx="7" cy="7" r="1.9" fill="#2b2318"/>',
  city: '<circle cx="7" cy="7" r="4" fill="#f7efdd" stroke="#2b2318" stroke-width="1.1"/>',
  town: '<circle cx="7" cy="7" r="2.8" fill="#f7efdd" stroke="#2b2318" stroke-width="1.1"/>',
  port: '<circle cx="7" cy="7" r="3.4" fill="#f7efdd" stroke="#2b2318" stroke-width="1.1"/><path d="M2 11.4h10" stroke="#2b2318" stroke-width="1.1" fill="none"/>',
  fortress: '<rect x="3" y="4" width="8" height="7" fill="#f7efdd" stroke="#2b2318" stroke-width="1.1"/>',
  oasis: '<path d="M7 2l5 5-5 5-5-5z" fill="#f7efdd" stroke="#2b2318" stroke-width="1.1"/>',
  shrine: '<path d="M7 2.2l4.6 8.6H2.4z" fill="#f7efdd" stroke="#2b2318" stroke-width="1.1"/>'
};

export const kindIcon = kind => `<svg viewBox="0 0 14 14" aria-hidden="true">${KIND_ICON[kind] || KIND_ICON.town}</svg>`;

export function renderLands(state, onSelect, onHover = () => {}, onEdit = () => {}) {
  const host = $("#lands");
  host.replaceChildren();
  for (const country of state.world.countries) {
    const count = state.world.cities.filter(c => c.country === country.id).length;
    const active = state.selection?.type === "country" && state.selection.id === country.id;
    const row = document.createElement("div");
    row.className = "land-row";
    const button = document.createElement("button");
    button.className = `land${active ? " active" : ""}`;
    button.innerHTML = `<i style="background:${esc(country.color)}"></i><b>${esc(country.name)}</b><small>${count}</small>`;
    button.addEventListener("click", () => onSelect({ type: "country", id: country.id }));
    button.addEventListener("pointerenter", () => onHover({ type: "country", id: country.id }));
    button.addEventListener("pointerleave", () => onHover(null));
    button.addEventListener("focus", () => onHover({ type: "country", id: country.id }));
    button.addEventListener("blur", () => onHover(null));
    const edit = document.createElement("button");
    edit.className = "mini-btn keeper-only land-edit";
    edit.type = "button";
    edit.textContent = "✎";
    edit.title = `Править землю «${country.name}»`;
    edit.setAttribute("aria-label", `Править землю ${country.name}`);
    edit.addEventListener("click", () => onEdit(country.id));
    row.append(button, edit);
    host.append(row);
  }
}

export function renderFilters(state, onChange) {
  const host = $("#filters");
  const options = [["all", "Все"], ["capital", "Столицы"], ["city", "Города"], ["port", "Порты"], ["fortress", "Крепости"], ["other", "Прочее"]];
  host.replaceChildren();
  for (const [value, label] of options) {
    const chip = document.createElement("button");
    chip.className = `chip${state.filter === value ? " active" : ""}`;
    chip.textContent = label;
    chip.addEventListener("click", () => onChange(value));
    host.append(chip);
  }
}

export function matchesFilter(city, filter) {
  if (filter === "all") return true;
  if (filter === "other") return ["town", "oasis", "shrine"].includes(city.kind);
  return city.kind === filter;
}

export function visibleCities(state) {
  const q = state.query.trim().toLowerCase();
  return state.world.cities
    .filter(city => matchesFilter(city, state.filter))
    .filter(city => !state.landFocus || city.country === state.landFocus)
    .filter(city => {
      if (!q) return true;
      const country = state.world.countries.find(c => c.id === city.country);
      return `${city.name} ${city.summary} ${country?.name ?? ""}`.toLowerCase().includes(q);
    })
    .sort((a, b) => (a.kind === "capital" ? -1 : b.kind === "capital" ? 1 : b.population - a.population));
}

export function renderCities(state, onSelect, onHover = () => {}) {
  const host = $("#cities");
  const list = visibleCities(state);
  host.replaceChildren();
  $("#citiesHeading").textContent = state.landFocus
    ? `Поселения · ${state.world.countries.find(c => c.id === state.landFocus)?.name ?? ""}`
    : `Поселения (${list.length})`;
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Ничего не найдено. Попробуйте другое слово.";
    host.append(li);
    return;
  }
  for (const city of list) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.className = `city-row${state.selection?.type === "city" && state.selection.id === city.id ? " active" : ""}`;
    button.innerHTML = `${kindIcon(city.kind)}<span>${esc(city.name)}</span><em>${esc(people(city.population))}</em>`;
    button.addEventListener("click", () => onSelect({ type: "city", id: city.id }));
    button.addEventListener("pointerenter", () => onHover({ type: "city", id: city.id }));
    button.addEventListener("pointerleave", () => onHover(null));
    button.addEventListener("focus", () => onHover({ type: "city", id: city.id }));
    button.addEventListener("blur", () => onHover(null));
    li.append(button);
    host.append(li);
  }
}

const fact = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;

function countryView(state, country) {
  const cities = state.world.cities.filter(c => c.country === country.id);
  const capital = state.world.cities.find(c => c.id === country.capital);
  return `
    <p class="kicker"><i style="background:${esc(country.color)}"></i>Земля Родмура</p>
    <h1>${esc(country.name)}</h1>
    <p class="full-name">${esc(country.fullName)}</p>
    ${country.motto ? `<p class="motto">«${esc(country.motto)}»</p>` : ""}
    <dl class="facts">
      ${fact("Столица", capital?.name || "—")}
      ${fact("Население", `${people(country.population)} чел.`)}
      ${fact("Площадь", area(country.area))}
      ${fact("Поселений", num(cities.length))}
      ${country.terrain && TERRAINS[country.terrain] ? fact("Природа", TERRAINS[country.terrain]) : ""}
      ${fact("Устройство", country.government || "—")}
      ${fact("Правитель", country.ruler || "—")}
    </dl>
    <p class="lede">${esc(country.summary)}</p>
    <p>${esc(country.description)}</p>
    ${country.history ? `<h3>Летопись</h3><p>${esc(country.history)}</p>` : ""}
    ${country.economy ? `<h3>Ремёсла и торг</h3><p>${esc(country.economy)}</p>` : ""}
    ${country.military ? `<h3>Ратное дело</h3><p>${esc(country.military)}</p>` : ""}
    <h3>Поселения земли</h3>
    <ul class="link-list">
      ${cities
        .sort((a, b) => b.population - a.population)
        .map(c => `<li><button data-goto-city="${esc(c.id)}"><span>${esc(c.name)}</span><small>${esc(KINDS[c.kind] || "")} · ${esc(people(c.population))}</small></button></li>`)
        .join("")}
    </ul>
    <div class="detail-actions">
      <button class="ghost-btn" data-action="zoom-country">Показать землю</button>
      <button class="solid-btn keeper-only" data-action="edit-country">Редактировать</button>
    </div>`;
}

function cityView(state, city) {
  const country = state.world.countries.find(c => c.id === city.country);
  const roads = state.world.roads.filter(r => r.from === city.id || r.to === city.id);
  const river = state.world.rivers.find(r => r.id === city.river);
  return `
    <p class="kicker"><i style="background:${esc(country?.color || "#999")}"></i>${esc(KINDS[city.kind] || "Поселение")} · ${esc(country?.name || "")}</p>
    <h1>${esc(city.name)}</h1>
    <p class="full-name">${esc(city.summary)}</p>
    <dl class="facts">
      ${fact("Население", `${num(city.population)} чел.`)}
      ${fact("Основан", `${city.founded} г.`)}
      ${fact("Высота", `${num(city.elevation)} м`)}
      ${fact("Положение", city.port ? "Морской берег" : river ? `На реке ${river.name}` : "Внутренние земли")}
      ${fact("Правитель", city.ruler || "—")}
      ${fact("Земля", country?.name || "—")}
    </dl>
    <p>${esc(city.description)}</p>
    ${city.notables?.length ? `<h3>Чем известен</h3><ul class="tags">${city.notables.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    ${roads.length ? `<h3>Пути (${roads.length})</h3><ul class="link-list roads">${roads
      .map(r => {
        const otherId = r.from === city.id ? r.to : r.from;
        const other = state.world.cities.find(c => c.id === otherId);
        return `<li class="road-row"><button data-goto-city="${esc(otherId)}"><span>${esc(other?.name || otherId)}</span><small>${esc(ROAD_KINDS[r.kind])} · ${num(r.length)} км</small></button><button class="mini-btn keeper-only" data-del-road="${esc(r.id)}" title="Убрать путь" aria-label="Убрать путь до ${esc(other?.name || otherId)}">✕</button></li>`;
      })
      .join("")}</ul>` : ""}
    <div class="keeper-only road-tools">
      <h3>Проложить путь</h3>
      <form class="form" id="roadForm" data-from="${esc(city.id)}">
        <div class="row">
          <select name="to" aria-label="Куда">${state.world.cities
            .filter(c => c.id !== city.id && !roads.some(r => r.from === c.id || r.to === c.id))
            .sort((a, b) => a.name.localeCompare(b.name, "ru"))
            .map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`)
            .join("")}</select>
          <select name="kind" aria-label="Тип пути">${Object.entries(ROAD_KINDS).map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("")}</select>
        </div>
        <div class="modal-actions left"><button type="submit" class="solid-btn">Проложить</button></div>
      </form>
    </div>
    <div class="detail-actions">
      <button class="ghost-btn" data-goto-country="${esc(city.country)}">Земля ${esc(country?.name || "")}</button>
      <button class="ghost-btn" data-action="zoom-city">Приблизить</button>
      <button class="solid-btn keeper-only" data-action="edit-city">Редактировать</button>
      <button class="mini-btn keeper-only" data-action="delete-city">Удалить</button>
    </div>
    <p class="keeper-only hintline" style="margin-top:10px;font-family:var(--ui);font-size:11px;color:var(--ink-faint)">Подсказка: город можно перетащить прямо по карте.</p>`;
}

const field = (label, name, value, type = "text", extra = "") =>
  `<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value ?? "")}" ${extra} /></label>`;
const area_ = (label, name, value, rows = 4) =>
  `<label>${esc(label)}<textarea name="${name}" rows="${rows}">${esc(value ?? "")}</textarea></label>`;
const select = (label, name, value, options) =>
  `<label>${esc(label)}<select name="${name}">${options
    .map(([v, t]) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(t)}</option>`)
    .join("")}</select></label>`;

function countryForm(state, country) {
  const cities = state.world.cities.filter(c => c.country === country.id);
  return `
    <p class="kicker"><i style="background:${esc(country.color)}"></i>Правка земли</p>
    <h1>${esc(country.name)}</h1>
    <form class="form" id="editForm" data-kind="country" data-id="${esc(country.id)}">
      <p class="hintline">Название, цвет и подпись меняются на карте сразу — «Сохранить» записывает их в атлас.</p>
      <div class="row">${field("Название", "name", country.name, "text", 'required maxlength="60"')}${field("Цвет", "color", country.color, "color")}</div>
      ${field("Полное имя", "fullName", country.fullName, "text", 'maxlength="120"')}
      ${select("Столица", "capital", country.capital, [["", "— не выбрана —"], ...cities.map(c => [c.id, c.name])])}
      ${select("Природа земли", "terrain", country.terrain || "", Object.entries(TERRAINS))}
      <p class="hintline">Природа меняет пятна почв и породу знаков внутри границ земли: луга, степь, лес, пустыня. Горы и реки остаются на месте.</p>
      <div class="row">${field("Устройство", "government", country.government)}${field("Правитель", "ruler", country.ruler)}</div>
      ${field("Девиз", "motto", country.motto, "text", 'maxlength="160"')}
      ${area_("Кратко", "summary", country.summary, 2)}
      ${area_("Описание", "description", country.description, 5)}
      ${area_("Летопись", "history", country.history, 4)}
      ${area_("Ремёсла и торг", "economy", country.economy, 3)}
      ${area_("Ратное дело", "military", country.military, 3)}
      <h3>Подпись на карте</h3>
      <div class="row">${field("X", "label.x", country.label?.x ?? 0, "number", 'step="1"')}${field("Y", "label.y", country.label?.y ?? 0, "number", 'step="1"')}</div>
      <div class="row">${field("Наклон", "label.rotate", country.label?.rotate ?? 0, "number", 'step="1"')}${field("Кегль", "label.size", country.label?.size ?? 24, "number", 'step="1" min="8" max="80"')}</div>
      <p class="error" hidden></p>
      <div class="modal-actions left">
        <button type="submit" class="solid-btn">Сохранить</button>
        <button type="button" class="ghost-btn" data-action="cancel-edit">Отмена</button>
      </div>
    </form>`;
}

function cityForm(state, city) {
  const isNew = !city.id;
  return `
    <p class="kicker">${isNew ? "Новое поселение" : "Правка поселения"}</p>
    <h1>${esc(city.name || "Без имени")}</h1>
    <form class="form" id="editForm" data-kind="city" data-id="${esc(city.id || "")}">
      ${isNew ? field("Идентификатор (латиницей)", "id", city.id || "", "text", 'required pattern="[a-z0-9][a-z0-9\\-]{0,48}" maxlength="49" title="Латинские буквы, цифры и дефис"') : ""}
      <div class="row">
        ${field("Название", "name", city.name, "text", 'required maxlength="60"')}
        ${select("Тип", "kind", city.kind || "town", Object.entries(KINDS))}
      </div>
      ${select("Земля", "country", city.country, state.world.countries.map(c => [c.id, c.name]))}
      <div class="row">
        ${field("Население", "population", city.population ?? 1000, "number", 'min="0" max="50000000"')}
        ${field("Год основания", "founded", city.founded ?? 1000, "number", 'min="-5000" max="5000"')}
      </div>
      ${field("Правитель", "ruler", city.ruler)}
      ${area_("Кратко", "summary", city.summary, 2)}
      ${area_("Описание", "description", city.description, 5)}
      ${area_("Чем известен (по строке)", "notables", (city.notables || []).join("\n"), 3)}
      <div class="row">${field("X на карте", "x", city.x, "number", 'step="0.1"')}${field("Y на карте", "y", city.y, "number", 'step="0.1"')}</div>
      <label class="switch" style="text-transform:none;letter-spacing:normal;font-size:12.5px">
        <input type="checkbox" name="port" ${city.port ? "checked" : ""} /><span></span>Морской порт
      </label>
      <p class="hintline">Координаты можно задать щелчком по карте или перетаскиванием значка.</p>
      <p class="error" hidden></p>
      <div class="modal-actions left">
        <button type="submit" class="solid-btn">${isNew ? "Создать" : "Сохранить"}</button>
        <button type="button" class="ghost-btn" data-action="cancel-edit">Отмена</button>
      </div>
    </form>`;
}

export function renderDetail(state, mode) {
  const host = $("#detailBody");
  const panel = $("#detail");
  const show = visible => {
    panel.hidden = !visible;
    document.body.classList.toggle("detail-open", visible);
  };
  if (!state.selection && mode !== "new-city") return show(false);

  if (mode === "new-city") {
    host.innerHTML = cityForm(state, state.draftCity);
    show(true);
    return;
  }
  if (state.selection.type === "country") {
    const country = state.world.countries.find(c => c.id === state.selection.id);
    if (!country) return show(false);
    host.innerHTML = mode === "edit" ? countryForm(state, country) : countryView(state, country);
  } else {
    const city = state.world.cities.find(c => c.id === state.selection.id);
    if (!city) return show(false);
    host.innerHTML = mode === "edit" ? cityForm(state, city) : cityView(state, city);
  }
  show(true);
  panel.scrollTop = 0;
}

export function readForm(form) {
  const data = {};
  for (const element of form.elements) {
    if (!element.name) continue;
    const value = element.type === "checkbox" ? element.checked : element.value;
    if (element.name.includes(".")) {
      const [group, key] = element.name.split(".");
      data[group] = { ...(data[group] || {}), [key]: Number(value) };
    } else if (element.name === "notables") {
      data.notables = String(value).split("\n").map(s => s.trim()).filter(Boolean);
    } else if (element.type === "number") {
      data[element.name] = Number(value);
    } else {
      data[element.name] = value;
    }
  }
  if (data.capital === "") data.capital = null;
  return data;
}
