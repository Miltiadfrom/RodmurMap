// Полный сценарий редактора карты: знаки, леса, реки, озёра, надписи, метки,
// ластик и возврат подложки, поселения и пути, свойства, отмена, посетитель, телефон.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.ATLAS_URL || "http://127.0.0.1:8080";
const PASSWORD = process.env.RODMUR_ADMIN_PASSWORD || "pzVuNBI4GjyF";
const OUT = "tools/out";
mkdirSync(OUT, { recursive: true });

const problems = [];
const failures = [];
const log = (...a) => console.log(...a);
const check = (name, ok, detail = "") => {
  log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures.push(name + (detail ? ` (${detail})` : ""));
};

const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=700"]
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(15000);
page.on("pageerror", e => problems.push(`pageerror: ${e.message}`));
page.on("console", m => {
  if (m.type() === "error" && !m.text().includes("401") && !m.text().includes("400")) problems.push(`console: ${m.text()}`);
});
page.on("response", async response => {
  const url = new URL(response.url());
  if (!url.pathname.startsWith("/api/") || response.status() < 400 || response.status() === 401) return;
  const body = await response.text().catch(() => "");
  problems.push(`${response.request().method()} ${url.pathname} → ${response.status()} ${body.slice(0, 160)}`);
});
page.on("dialog", d => d.accept());

await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector("#loading", { state: "hidden", timeout: 60000 });
await page.waitForTimeout(700);

const raw = await (await fetch(`${BASE}/api/world`)).json();
const snapshot = { ...raw, seas: raw.seas.map(sea => ({ ...sea, name: sea.name.replace(/ Правки$/, "") })) };
// тест начинается с чистой подложки: прошлые прогоны не должны влиять на счётчики
const startCities = snapshot.cities.filter(city => city.name !== "Пробный острог");
const startIds = new Set(startCities.map(city => city.id));
const startWorld = {
  ...snapshot,
  cities: startCities,
  roads: snapshot.roads.filter(road => startIds.has(road.from) && startIds.has(road.to)),
  features: { icons: [], hidden: [], forests: [], rivers: [], lakes: [], labels: [], markers: [] }
};
const featureCounts = async () => {
  const world = await (await fetch(`${BASE}/api/world`)).json();
  return Object.fromEntries(Object.entries(world.features).map(([k, v]) => [k, v.length]));
};
const dom = selector => page.locator(selector).count();
const waitDom = async (selector, count) => {
  await page.waitForFunction(({ selector, count }) => document.querySelectorAll(selector).length === count, { selector, count }, { timeout: 6000 }).catch(() => {});
  return dom(selector);
};
// Ответ сервера и отрисовка клиента — две разные гонки: ждём саму карту, а не таймер.
const waitSome = async (selector, min = 1) => {
  await page.waitForFunction(({ selector, min }) => document.querySelectorAll(selector).length >= min, { selector, min }, { timeout: 6000 }).catch(() => {});
  return dom(selector);
};
const waitText = async (selector, text) => {
  await page.waitForFunction(({ selector, text }) =>
    [...document.querySelectorAll(selector)].some(node => node.textContent.includes(text)), { selector, text }, { timeout: 6000 }).catch(() => {});
  return page.locator(selector, { hasText: text }).count();
};

// публичная страница: ни редактора, ни входа, ни кода редактора
const publicChrome = await page.evaluate(() => ({
  editorBtn: !!document.querySelector("#editorBtn"),
  editor: !!document.querySelector("#editor"),
  keeperBtn: !!document.querySelector("#keeperBtn"),
  login: !!document.querySelector("#loginModal"),
  keeperPanel: !!document.querySelector("#keeperModal"),
  editorScript: performance.getEntriesByType("resource").some(r => r.name.includes("editor.js"))
}));
check("у посетителя нет органов правки", Object.values(publicChrome).every(v => !v), JSON.stringify(publicChrome));
check("карта у посетителя есть", (await dom("#atlas .city-node")) > 50, String(await dom("#atlas .city-node")));

// мастерская хранителя — отдельная страница с заставой
const ensureEditor = async on => {
  const editing = await page.locator("body").evaluate(n => n.classList.contains("editing"));
  if (editing !== on) {
    await page.locator(on ? "#editorBtn" : "#editorExit").click();
    await page.waitForTimeout(700);
  }
};
await page.goto(`${BASE}/admin`, { waitUntil: "load" });
await page.waitForSelector("#gateForm", { timeout: 30000 });
check("мастерская закрыта заставой", await page.locator("body").evaluate(n => n.classList.contains("gated")) &&
  (await dom("#atlas .city-node")) === 0);
await page.fill("#gatePassword", PASSWORD);
await page.locator("#gateForm button[type=submit]").click();
await page.waitForSelector("#loading", { state: "hidden", timeout: 60000 });
await page.waitForTimeout(1100);
check("хранитель вошёл", await page.locator("body").evaluate(n => n.classList.contains("keeper")));
check("кнопка редактора появилась", await page.locator("#editorBtn").isVisible());
check("мастерская открылась с верстаком", await page.locator("body").evaluate(n => n.classList.contains("editing")));
await page.evaluate(async world => {
  const session = await (await fetch("/api/session")).json();
  await fetch("/api/world", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-csrf-token": session.csrf },
    body: JSON.stringify(world)
  });
}, startWorld);
await page.reload({ waitUntil: "load" });
await page.waitForSelector("#loading", { state: "hidden", timeout: 60000 });
await page.waitForTimeout(1100);

await ensureEditor(true);
const tools = await dom("#editorRail .tool-btn");
check("инструментов не меньше 10", tools >= 10, `${tools}`);
const panelBox = await page.locator(".editor-panel").boundingBox();
check("панель настроек видна целиком", panelBox.x > 700 && panelBox.width > 260 && panelBox.y + panelBox.height <= 900, JSON.stringify(panelBox));
const railBox = await page.locator("#editorRail").boundingBox();
check("верстак инструментов на месте", railBox.x >= 0 && railBox.y >= 0, JSON.stringify(railBox));
await page.screenshot({ path: `${OUT}/editor-01-open.png`, animations: "disabled" });

const map = await page.locator("#atlas").boundingBox();
const px = (fx, fy) => ({ x: map.x + map.width * fx, y: map.y + map.height * fy });
const stroke = async (from, to, steps = 12) => {
  const a = px(...from), b = px(...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
  await page.mouse.up();
  await page.waitForTimeout(1100);
};
const outline = async points => {
  for (const point of points) {
    const p = px(...point);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(110);
  }
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
};
const pickTool = async id => {
  await page.locator(`#editorRail .tool-btn[data-tool=${id}]`).click();
  await page.waitForTimeout(250);
};

// ── кисть знаков ─────────────────────────────────────────────────────
await pickTool("icon");
const iconControls = await dom("#editorControls input, #editorControls select, #editorControls .chip-pick");
check("у кисти не меньше 7 ручек", iconControls >= 7, `${iconControls}`);
await page.locator('#editorControls .chip-pick[data-chip=mount]').click();
await stroke([0.40, 0.40], [0.50, 0.44]);
let counts = await featureCounts();
check("знаки легли на карту", counts.icons > 3, `${counts.icons}`);
check("знаки видны в SVG", (await waitDom("#ov-paintIcons use", counts.icons)) === counts.icons);

await page.locator("#editorUndo").click();
await page.waitForTimeout(1000);
check("отмена убрала знаки", (await featureCounts()).icons === 0);
await page.locator("#editorRedo").click();
await page.waitForTimeout(1000);
check("возврат вернул знаки", (await featureCounts()).icons === counts.icons);

// одиночный знак и свойства
await page.locator('#editorControls .switch', { hasText: "по одному" }).click();
const single = px(0.46, 0.36);
await page.mouse.click(single.x, single.y);
await page.waitForTimeout(1000);
const afterSingle = (await featureCounts()).icons;
check("одиночный знак поставлен", afterSingle === counts.icons + 1, `${afterSingle}`);

await pickTool("select");
await page.mouse.click(single.x, single.y);
await page.waitForTimeout(500);
check("знак выбран", (await page.locator("#editorSelection h4").textContent()).includes("Знак"), await page.locator("#editorSelection h4").textContent());
const pickBox = await page.locator("#ov-pick .pick-box").boundingBox();
check("рамка выделения вокруг знака, а не в углу", Math.abs(pickBox.x + pickBox.width / 2 - single.x) < 40 && Math.abs(pickBox.y + pickBox.height / 2 - single.y) < 40, JSON.stringify(pickBox));

// смена знака и размера через свойства
await page.locator("#editorSelection select").selectOption("vulcan");
await page.waitForTimeout(1000);
const world1 = await (await fetch(`${BASE}/api/world`)).json();
check("тип знака changed на сервере", world1.features.icons.some(i => i.type === "vulcan"));
await page.locator('#editorSelection input[type=range]').evaluate(n => {
  n.value = "2";
  n.dispatchEvent(new Event("input", { bubbles: true }));
  n.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(1100);
const world2 = await (await fetch(`${BASE}/api/world`)).json();
check("размер знака записан", world2.features.icons.some(i => i.size === 2));

// перенос знака
const target = px(0.49, 0.33);
await page.mouse.move(single.x, single.y);
await page.mouse.down();
await page.mouse.move(target.x, target.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(1100);
const moved = (await (await fetch(`${BASE}/api/world`)).json()).features.icons.find(i => i.type === "vulcan");
check("знак перенесён", moved && Math.abs(moved.x - (0.49 * 1600)) < 90, JSON.stringify(moved));

// ── лес ──────────────────────────────────────────────────────────────
await pickTool("forest");
await page.locator('#editorControls input[type=text]').fill("Ловчий бор");
await outline([[0.28, 0.58], [0.34, 0.54], [0.39, 0.60], [0.35, 0.67], [0.28, 0.65]]);
check("лес нарисован", (await featureCounts()).forests === 1);
const trees = await waitSome("#ov-paintForests use", 11);
check("в лесу выросли деревья", trees > 10, `${trees}`);
check("у леса есть подпись", (await waitText("#ov-paintLabels text", "Ловчий бор")) === 1);
await page.locator("#editorSelection select").selectOption("deciduous");
await page.waitForTimeout(1100);
check("порода сменилась", (await waitSome("#ov-paintForests .forest-wash.deciduous", 1)) === 1);
await page.screenshot({ path: `${OUT}/editor-02-forest.png`, animations: "disabled" });

// ── река ─────────────────────────────────────────────────────────────
await pickTool("river");
await page.locator('#editorControls input[type=text]').fill("Тихая");
await outline([[0.32, 0.60], [0.37, 0.65], [0.43, 0.69], [0.49, 0.76]]);
check("река проведена", (await featureCounts()).rivers === 1);
check("русло нарисовано", (await waitSome("#ov-paintRivers path", 1)) === 1);
check("река подписана", (await waitText("#ov-paintLabels text", "Тихая")) === 1);

// ── озеро ────────────────────────────────────────────────────────────
await pickTool("lake");
await page.locator('#editorControls input[type=text]').fill("Светлое озеро");
await outline([[0.60, 0.32], [0.65, 0.30], [0.68, 0.35], [0.63, 0.39]]);
check("озеро налито", (await featureCounts()).lakes === 1);
check("озеро подписано", (await waitText("#ov-paintLabels text", "Светлое озеро")) === 1);

// ── надпись и метка ──────────────────────────────────────────────────
await pickTool("label");
await page.locator('#editorControls input[type=text]').fill("Пустоши Хаар");
await page.locator("#editorControls select").selectOption("range");
let point = px(0.55, 0.28);
await page.mouse.click(point.x, point.y);
await page.waitForTimeout(1100);
check("надпись поставлена", (await featureCounts()).labels === 1);
await page.locator('#editorSelection input[type=text]').fill("Пустоши Хаар-Дор");
await page.locator('#editorSelection input[type=text]').press("Enter");
await page.waitForTimeout(1200);
check("текст надписи правится", (await waitText("#ov-paintLabels text", "Пустоши Хаар-Дор")) === 1);

await pickTool("marker");
await page.locator('#editorControls input[type=text]').fill("Брод Пяти Камней");
await page.locator('#editorControls .chip-pick[data-chip=battle]').click();
point = px(0.58, 0.52);
await page.mouse.click(point.x, point.y);
await page.waitForTimeout(1100);
check("метка поставлена", (await featureCounts()).markers === 1);
check("метка подписана", (await waitText("#ov-paintMarkers text", "Брод Пяти Камней")) === 1);
await page.screenshot({ path: `${OUT}/editor-03-features.png`, animations: "disabled" });

// ── поселение и путь прямо из редактора ──────────────────────────────
await pickTool("city");
await page.locator("#editorControls select").selectOption("fortress");
await page.locator('#editorControls input[type=text]').fill("Пробный острог");
point = px(0.52, 0.60);
await page.mouse.click(point.x, point.y);
await page.waitForSelector("#editForm", { timeout: 10000 });
check("карточка нового поселения открылась", await page.locator("#editForm").isVisible());
check("тип поселения подставлен", (await page.locator("#editForm select[name=kind]").inputValue()) === "fortress");
const cardBox = await page.locator("#detail").boundingBox();
const editorBox = await page.locator(".editor-panel").boundingBox();
check("карточка города не накрывает редактор", editorBox.x + editorBox.width <= cardBox.x + 1, JSON.stringify({ editorBox, cardBox }));
await page.screenshot({ path: `${OUT}/editor-07-city-card.png`, animations: "disabled" });
await page.locator('#editForm input[name=name]').fill("Пробный острог");
await page.locator("#editForm button[type=submit]").click();
await page.waitForTimeout(1400);
const world3 = await (await fetch(`${BASE}/api/world`)).json();
const testCity = world3.cities.find(c => c.name === "Пробный острог");
check("поселение создано", Boolean(testCity), testCity?.id);

await pickTool("road");
await page.locator("#zoomFit").click();
await page.waitForTimeout(900);
const free = { left: railBox.x + railBox.width + 20, right: panelBox.x - 20, top: map.y + 20, bottom: map.y + map.height - 20 };
const pair = await page.evaluate(async bounds => {
  const world = await (await fetch("/api/world")).json();
  const linked = new Set(world.roads.map(r => `${r.from}|${r.to}`));
  const connected = (a, b) => linked.has(`${a}|${b}`) || linked.has(`${b}|${a}`);
  const onScreen = id => {
    const node = document.querySelector(`#atlas .city-node[data-city="${id}"]`);
    if (!node) return false;
    const box = node.getBoundingClientRect();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    return cx > bounds.left && cx < bounds.right && cy > bounds.top && cy < bounds.bottom;
  };
  const visible = world.cities.filter(c => onScreen(c.id));
  for (const a of visible) {
    for (const b of visible) {
      if (a.id === b.id || connected(a.id, b.id)) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) < 150) continue;
      return [a.id, b.id];
    }
  }
  return null;
}, free);
check("найдены два несвязанных города", Boolean(pair), JSON.stringify(pair));
const before4 = (await (await fetch(`${BASE}/api/world`)).json()).roads.length;
for (const id of pair) {
  const box = await page.locator(`#atlas .city-node[data-city="${id}"]`).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(500);
}
await page.waitForTimeout(1400);
const world4 = await (await fetch(`${BASE}/api/world`)).json();
check("путь проложен между городами", world4.roads.length === before4 + 1, `${before4} → ${world4.roads.length}`);
check("путь лёг на карту", world4.roads.some(r => (r.from === pair[0] && r.to === pair[1]) || (r.from === pair[1] && r.to === pair[0])));

// ── переименование подписи подложки ──────────────────────────────────
await pickTool("select");
const seaLabel = page.locator('#atlas [data-base-label^="seas:"]').first();
const seaRef = await seaLabel.getAttribute("data-base-label");
const seaBox = await seaLabel.boundingBox();
await page.mouse.click(seaBox.x + seaBox.width / 2, seaBox.y + seaBox.height / 2);
await page.waitForTimeout(600);
check("подпись моря выбрана", (await page.locator("#editorSelection h4").textContent()).includes("Море"), await page.locator("#editorSelection h4").textContent());
await page.locator('#editorSelection input[type=text]').fill("Стылое море Правки");
await page.locator('#editorSelection input[type=text]').press("Enter");
await page.waitForTimeout(1300);
const seaId = seaRef.split(":")[1];
const world5 = await (await fetch(`${BASE}/api/world`)).json();
check("имя моря записано", world5.seas.find(s => s.id === seaId)?.name === "Стылое море Правки");

// ── природа земли прямо в редакторе ──────────────────────────────────
const landLabel = page.locator('#atlas [data-country-label="sarti"]');
const landBox = await landLabel.boundingBox();
await page.mouse.click(landBox.x + landBox.width / 2, landBox.y + landBox.height / 2);
await page.waitForTimeout(700);
const landTitle = await page.locator("#editorSelection h4").textContent();
check("земля выбрана в редакторе", landTitle.includes("Земля"), landTitle);
const terrainPick = page.locator("#editorSelection select");
check("природа земли в панели", (await terrainPick.inputValue()) === "meadow", await terrainPick.inputValue());
await terrainPick.selectOption("steppe");
await page.waitForTimeout(1400);
const worldTerrain = await (await fetch(`${BASE}/api/world`)).json();
check("природа записана на сервер", worldTerrain.countries.find(c => c.id === "sarti")?.terrain === "steppe",
  worldTerrain.countries.find(c => c.id === "sarti")?.terrain);
check("пятна почв перекрашены", await page.evaluate(() =>
  document.querySelector('#terrain-lands [data-terrain="sarti"]')?.dataset.terrainKind) === "steppe");
await page.locator("#editorSelection select").selectOption("meadow");
await page.waitForTimeout(1400);
const worldMeadow = await (await fetch(`${BASE}/api/world`)).json();
check("луга возвращены", worldMeadow.countries.find(c => c.id === "sarti")?.terrain === "meadow",
  worldMeadow.countries.find(c => c.id === "sarti")?.terrain);

// ── ластик и возврат подложки ────────────────────────────────────────
const beforeErase = await featureCounts();
await pickTool("erase");
await stroke([0.40, 0.40], [0.50, 0.44]);
const afterErase = await featureCounts();
check("ластик стёр свои знаки", afterErase.icons < beforeErase.icons, `${beforeErase.icons} → ${afterErase.icons}`);
check("ластик стёр знаки подложки", afterErase.hidden > 0, `${afterErase.hidden}`);

await pickTool("restore");
await stroke([0.40, 0.40], [0.50, 0.44]);
const afterRestore = await featureCounts();
check("возврат вернул знаки подложки", afterRestore.hidden < afterErase.hidden, `${afterErase.hidden} → ${afterRestore.hidden}`);
await page.screenshot({ path: `${OUT}/editor-04-erase.png`, animations: "disabled" });

// стирание реки подложки и её возврат
await pickTool("erase");
const riverPath = page.locator("#fmg-base #rivers path").first();
const riverBox = await riverPath.boundingBox();
const riverId = await riverPath.getAttribute("id");
await page.mouse.move(riverBox.x + riverBox.width / 2, riverBox.y + riverBox.height / 2);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(1200);
const hiddenRiver = (await (await fetch(`${BASE}/api/world`)).json()).features.hidden.some(h => h.kind === "river" && h.ref === riverId);
check("река подложки стёрта", hiddenRiver, riverId);
check("река исчезла с карты", (await page.locator(`#fmg-base #rivers #${riverId}`).evaluate(n => getComputedStyle(n).display)) === "none");
await pickTool("restore");
await page.mouse.move(riverBox.x + riverBox.width / 2, riverBox.y + riverBox.height / 2);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(1200);
check("река подложки вернулась", (await page.locator(`#fmg-base #rivers #${riverId}`).evaluate(n => getComputedStyle(n).display)) !== "none");

// ── сохранение между перезагрузками и посетитель ─────────────────────
const savedCounts = await featureCounts();
await page.reload({ waitUntil: "load" });
await page.waitForSelector("#loading", { state: "hidden", timeout: 60000 });
await page.waitForTimeout(1000);
check("правки пережили перезагрузку", (await dom("#ov-paintForests .paint-forest")) === savedCounts.forests &&
  (await dom("#ov-paintRivers path")) === savedCounts.rivers && (await dom("#ov-paintLakes path")) === savedCounts.lakes);

// ── телефон ──────────────────────────────────────────────────────────
await ensureEditor(true);
await page.emulateMedia({ reducedMotion: "reduce" });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(900);
const mobileRail = await page.locator("#editorRail").boundingBox();
const mobilePanel = await page.locator(".editor-panel").boundingBox();
check("инструменты прокручиваются поперёк телефона", mobileRail.width > 300 && mobileRail.height < 120, JSON.stringify(mobileRail));
check("панель помещается в телефон", mobilePanel.x >= 0 && mobilePanel.x + mobilePanel.width <= 390 && mobilePanel.y + mobilePanel.height <= 844, JSON.stringify(mobilePanel));
await page.screenshot({ path: `${OUT}/editor-06-mobile.png`, animations: "disabled" });
await page.setViewportSize({ width: 1440, height: 900 });
await page.emulateMedia({ reducedMotion: null });
await page.waitForTimeout(500);

// ── посетитель в отдельном браузере: две карты не помещаются в память песочницы ──
await browser.close();
const guestBrowser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=500"]
});
const visitor = await guestBrowser.newPage({ viewport: { width: 1280, height: 800 } });
visitor.on("pageerror", e => problems.push(`visitor pageerror: ${e.message}`));
// мастерская для гостя — только застава, атласа за ней не видно
await visitor.goto(`${BASE}/admin`, { waitUntil: "load" });
await visitor.waitForSelector("#gateForm", { timeout: 30000 });
await visitor.waitForTimeout(700);
check("гостю мастерская показывает заставу", await visitor.locator("#gateForm").isVisible() &&
  (await visitor.locator("#atlas .city-node").count()) === 0);
await visitor.screenshot({ path: `${OUT}/editor-08-guest-gate.png`, animations: "disabled" });
await visitor.goto(`${BASE}/map_redactor`, { waitUntil: "load" });
await visitor.waitForTimeout(700);
check("адрес /map_redactor ведёт в мастерскую", await visitor.evaluate(() =>
  document.body.dataset.page === "admin" && document.body.classList.contains("gated")));

await visitor.goto(BASE, { waitUntil: "load" });
await visitor.waitForSelector("#loading", { state: "hidden", timeout: 60000 });
await visitor.waitForTimeout(1000);
check("посетитель видит нарисованный лес", (await visitor.locator("#ov-paintForests .paint-forest").count()) === savedCounts.forests);
check("посетитель видит реку и озеро", (await visitor.locator("#ov-paintRivers path").count()) === savedCounts.rivers &&
  (await visitor.locator("#ov-paintLakes path").count()) === savedCounts.lakes);
check("у посетителя нет редактора", !(await visitor.locator("#editorBtn").isVisible()) && !(await visitor.locator("#editor").isVisible()));
await visitor.screenshot({ path: `${OUT}/editor-05-visitor.png`, animations: "disabled" });
await guestBrowser.close();

// ── уборка за тестом ─────────────────────────────────────────────────
let cookie = "";
const call = async (path, method, body, csrfToken) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  for (const value of res.headers.getSetCookie?.() || []) cookie = value.split(";")[0];
  const text = await res.text();
  if (!res.ok) problems.push(`${method} ${path} → ${res.status}: ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : {};
};
const session = await call("/api/login", "POST", { password: PASSWORD });
const keepCities = snapshot.cities.filter(city => city.name !== "Пробный острог");
const keepIds = new Set(keepCities.map(city => city.id));
const cleanWorld = {
  ...snapshot,
  cities: keepCities,
  roads: snapshot.roads.filter(road => keepIds.has(road.from) && keepIds.has(road.to)),
  features: { icons: [], hidden: [], forests: [], rivers: [], lakes: [], labels: [], markers: [] }
};
await call("/api/world", "PUT", cleanWorld, session.csrf);
const clean = await featureCounts();
check("атлас возвращён к исходному виду", Object.values(clean).every(v => v === 0), JSON.stringify(clean));
const restored = await call("/api/world", "GET");
check("тестовое поселение убрано", !restored.cities.some(c => c.name === "Пробный острог"), `${restored.cities.length} поселений`);

log("\nproblems:", problems.length ? problems : "none");
log("failures:", failures.length ? failures : "none");
if (failures.length || problems.length) process.exitCode = 1;