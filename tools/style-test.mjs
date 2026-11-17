// Живое оформление рельефа и живая правка имени земли: полный сценарий с проверками.
// Запуск: атлас на :8080, затем `node tools/style-test.mjs`.
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
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;

const LAUNCH = {
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=700"]
};

// Два атласа разом не помещаются в память песочницы и роняют вкладку,
// поэтому в каждый момент живёт ровно одна страница карты.
async function openAtlas(path = "/") {
  const b = await chromium.launch(LAUNCH);
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on("pageerror", e => problems.push(`pageerror: ${e.message}`));
  p.on("console", m => { if (m.type() === "error" && !m.text().includes("401")) problems.push(`console: ${m.text()}`); });
  p.on("dialog", d => d.accept());
  await p.goto(BASE + path, { waitUntil: "load" });
  await p.waitForSelector("#loading", { state: "hidden", timeout: 60000 });
  await p.waitForTimeout(700);
  return { b, p };
}

/** Хранитель живёт на отдельной странице: застава с паролем, затем мастерская. */
async function loginKeeper(p) {
  await p.goto(`${BASE}/admin`, { waitUntil: "load" });
  await p.waitForSelector("#gateForm", { timeout: 30000 });
  await p.fill("#gatePassword", PASSWORD);
  await p.locator("#gateForm button[type=submit]").click();
  await p.waitForSelector("#loading", { state: "hidden", timeout: 60000 });
  await p.waitForTimeout(1000);
  if (await p.locator("body").evaluate(n => n.classList.contains("editing"))) {
    await p.locator("#editorExit").click();
    await p.waitForTimeout(600);
  }
}

async function openStyle(p) {
  if (await p.locator("#layersPop").isHidden()) {
    await p.locator("#layersBtn").click();
    await p.waitForSelector("#layersPop:not([hidden])");
    await p.waitForTimeout(800);
  }
}

let { b: browser, p: page } = await openAtlas();

// Снимок состояния рельефа. Крупность проверяем геометрией значка, а не CSS:
// знак должен расти от подножины и оставаться в своей клетке.
const reliefState = () => page.evaluate(() => {
  const group = document.querySelector("#fmg-base #terrain");
  const uses = [...group.querySelectorAll("use")];
  const probe = uses[12];
  const symbol = document.querySelector("#icons-library symbol[id^='relief-illustrated-hill-1']");
  const box = group.getBBox();
  return {
    total: uses.length,
    set: group.dataset.reliefSet,
    w: +probe.getAttribute("width"),
    h: +probe.getAttribute("height"),
    bottom: +probe.getAttribute("y") + +probe.getAttribute("height"),
    centre: +probe.getAttribute("x") + +probe.getAttribute("width") / 2,
    hidden: uses.filter(u => getComputedStyle(u).display === "none").length,
    hillHasWhite: /#fff\b|#ffffff\b/i.test(symbol?.innerHTML || ""),
    ink: +getComputedStyle(group).opacity,
    bbox: [box.x, box.y, box.width, box.height].map(n => Math.round(n))
  };
});

const boot = await reliefState();
log("relief at boot:", boot);
check("значков рельефа много", boot.total > 3000, `${boot.total}`);
check("набор по умолчанию — гравюра", boot.set === "illustrated", boot.set);
check("россыпь полная", boot.hidden === 0, `${boot.hidden} скрыто`);
const baseW = boot.w, baseBottom = boot.bottom, baseCentre = boot.centre;
const savedTint = (await (await fetch(`${BASE}/api/world`)).json()).meta.appearance.tint ?? 26;

// ── панель оформления ────────────────────────────────────────────────
await page.locator("#layersBtn").click();
await page.waitForSelector("#layersPop:not([hidden])");
await page.waitForTimeout(900); // дать анимации раскрытия и отрисовке закончиться
const controls = await page.locator("#layersPop input, #layersPop select").count();
check("панель открыта", await page.locator("#layersPop").isVisible());
check("ручек в панели не меньше 15", controls >= 15, `${controls}`);
const tintBoot = await page.evaluate(() => ({
  input: +document.querySelector("#tintStrength").value,
  label: document.querySelector("#tintValue").textContent,
  fill: +document.querySelector("#atlas .land-shape").getAttribute("fill-opacity")
}));
check("ползунок красок согласован с картой", tintBoot.label === `${tintBoot.input}%` && Math.abs(tintBoot.fill - tintBoot.input / 100) < 0.011, JSON.stringify(tintBoot));
await page.screenshot({ path: `${OUT}/style-01-panel.png`, animations: "disabled" });

await page.locator("#reliefSet").selectOption("simple");
await page.waitForTimeout(600);
const simple = await reliefState();
check("набор сменился на простые знаки", simple.set === "simple", simple.set);
check("простые знаки перекрашены под бумагу", !simple.hillHasWhite);
check("место значка не изменилось", near(simple.centre, baseCentre, 0.1), `${simple.centre} vs ${baseCentre}`);
await page.screenshot({ path: `${OUT}/style-02-simple.png`, animations: "disabled" });

const setRange = (sel, value) => page.locator(sel).evaluate((n, v) => {
  n.value = String(v);
  n.dispatchEvent(new Event("input", { bubbles: true }));
}, value);

const timing = await page.evaluate(() => {
  const start = performance.now();
  const input = document.querySelector("#reliefScale");
  input.value = "170";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.round(performance.now() - start)))));
});
await page.waitForTimeout(500);
const scaled = await reliefState();
log("scale 170% applied in ms:", timing);
check("крупность 170 % применена", near(scaled.w, baseW * 1.7, baseW * 0.02), `${scaled.w} vs ${(baseW * 1.7).toFixed(2)}`);
check("подножина знака на месте", near(scaled.bottom, baseBottom, 0.06), `${scaled.bottom} vs ${baseBottom}`);
check("центр знака на месте", near(scaled.centre, baseCentre, 0.06), `${scaled.centre} vs ${baseCentre}`);
check("рельеф не вылез за лист", scaled.bbox[0] > -30 && scaled.bbox[1] > -30 &&
  scaled.bbox[0] + scaled.bbox[2] < 1630 && scaled.bbox[1] + scaled.bbox[3] < 930, JSON.stringify(scaled.bbox));
check("подпись ползунка совпадает", (await page.locator("#reliefScaleValue").textContent()) === "170%");
await page.screenshot({ path: `${OUT}/style-03-scale-170.png`, animations: "disabled" });

await setRange("#reliefDensity", 45);
await page.waitForTimeout(500);
const sparse = await reliefState();
check("густота 45 % прячет примерно половину", sparse.hidden > boot.total * 0.45 && sparse.hidden < boot.total * 0.65, `${sparse.hidden} скрыто`);
await setRange("#reliefInk", 55);
// тяжёлая перерисовка рельефа может занять больше кадра — ждём, пока чернила доедут
await page.waitForFunction(() => {
  const g = document.querySelector("#fmg-base #terrain");
  return g && Math.abs(+getComputedStyle(g).opacity - 0.55) < 0.01;
}, null, { timeout: 8000 }).catch(() => {});
check("чернила 55 %", near((await reliefState()).ink, 0.55, 0.01), String((await reliefState()).ink));
await page.screenshot({ path: `${OUT}/style-04-tuned.png`, animations: "disabled" });

// переключатели бумаги
await page.locator("#paperGrid .switch", { hasText: "Фактура бумаги" }).click();
await page.waitForTimeout(300);
check("фактура выключается", (await page.locator("#fmg-base #texture").evaluate(n => getComputedStyle(n).display)) === "none");
await page.locator("#paperGrid .switch", { hasText: "Фактура бумаги" }).click();
await page.waitForTimeout(250);
check("фактура возвращается", (await page.locator("#fmg-base #texture").evaluate(n => getComputedStyle(n).display)) !== "none");

// слои и краски применяются сразу, без ожидания кадра
const roadsSwitch = page.locator("#layerGrid .switch", { hasText: "Пути" });
await roadsSwitch.click();
await page.waitForTimeout(250);
check("слой путей гаснет сразу", (await page.locator("#atlas #ov-roads").evaluate(n => getComputedStyle(n).display)) === "none");
await roadsSwitch.click();
await page.waitForTimeout(250);
check("слой путей возвращается сразу", (await page.locator("#atlas #ov-roads").evaluate(n => getComputedStyle(n).display)) !== "none");
await setRange("#tintStrength", 50);
await page.waitForTimeout(250);
check("краски земель 50 %", (await page.locator("#atlas .land-shape").first().getAttribute("fill-opacity")) === "0.50",
  await page.locator("#tintValue").textContent());

// сброс к сохранённому облику
await page.locator("#styleReset").click();
await page.waitForTimeout(700);
const reset = await reliefState();
check("сброс вернул гравюру", reset.set === boot.set, reset.set);
check("сброс вернул крупность", near(reset.w, baseW, 0.02), `${reset.w}`);
check("сброс вернул густоту и чернила", reset.hidden === 0 && near(reset.ink, 1, 0.01), `${reset.hidden}/${reset.ink}`);
check("сброс вернул краски земель", (await page.locator("#tintValue").textContent()) === `${Math.round(savedTint)}%`, await page.locator("#tintValue").textContent());

// ── вход хранителя и сохранение облика для всех ──────────────────────
await loginKeeper(page);
await openStyle(page);
check("хранитель вошёл", await page.locator("body").evaluate(n => n.classList.contains("keeper")));

await page.locator("#reliefSet").selectOption("simple");
await setRange("#reliefScale", 140);
await setRange("#reliefDensity", 70);
await page.waitForTimeout(600);
check("кнопка сохранения зовёт сохранить", await page.locator("#styleSave").evaluate(n => n.classList.contains("pulse")));
await page.locator("#styleSave").click();
await page.waitForTimeout(1300);
log("toast:", await page.locator("#toasts .toast").last().textContent());

const saved = await (await fetch(`${BASE}/api/world`)).json();
check("облик записан на сервер", saved.meta.appearance.reliefSet === "simple" && saved.meta.appearance.reliefScale === 1.4 && saved.meta.appearance.reliefDensity === 0.7,
  JSON.stringify(saved.meta.appearance));

// Посетитель видит сохранённый облик и не может его менять для других.
// Сначала закрываем страницу хранителя — иначе два атласа съедают всю память.
await browser.close();
const guestBrowser = await chromium.launch(LAUNCH);
const visitor = await guestBrowser.newPage({ viewport: { width: 1440, height: 900 } });
visitor.on("pageerror", e => problems.push(`visitor pageerror: ${e.message}`));
await visitor.goto(BASE, { waitUntil: "load" });
await visitor.waitForSelector("#loading", { state: "hidden", timeout: 60000 });
await visitor.waitForTimeout(900);
const guest = await visitor.evaluate(() => {
  const group = document.querySelector("#fmg-base #terrain");
  const uses = [...group.querySelectorAll("use")];
  const probe = uses[12];
  return {
    set: group.dataset.reliefSet,
    w: +probe.getAttribute("width"),
    hidden: uses.filter(u => getComputedStyle(u).display === "none").length
  };
});
check("посетитель получил сохранённый набор", guest.set === "simple", guest.set);
check("посетитель получил сохранённую крупность", near(guest.w, baseW * 1.4, baseW * 0.02), `${guest.w}`);
check("посетитель получил сохранённую густоту", guest.hidden > 0, `${guest.hidden} скрыто`);
check("у посетителя нет «Сохранить для всех»", !(await visitor.locator("#styleSave").isVisible()));
check("у посетителя нет ✎ у земель", (await visitor.locator(".land-edit:visible").count()) === 0);
check("посетитель видит луга Сарти", await visitor.evaluate(() =>
  document.querySelector('#terrain-lands [data-terrain="sarti"]')?.dataset.terrainKind) === "meadow");
await visitor.screenshot({ path: `${OUT}/style-05-visitor.png`, animations: "disabled" });
await visitor.close();
await guestBrowser.close();

// снова открываем атлас хранителем и возвращаем утверждённый облик
({ b: browser, p: page } = await openAtlas());
await loginKeeper(page);
await openStyle(page);
await page.locator("#reliefSet").selectOption("illustrated");
await setRange("#reliefScale", 100);
await setRange("#reliefDensity", 100);
await setRange("#reliefInk", 100);
await setRange("#tintStrength", 26);
await page.waitForTimeout(600);
await page.locator("#styleSave").click();
await page.waitForTimeout(1200);
const restoredLook = await (await fetch(`${BASE}/api/world`)).json();
check("облик по умолчанию возвращён", restoredLook.meta.appearance.reliefSet === "illustrated" && restoredLook.meta.appearance.reliefScale === 1,
  JSON.stringify(restoredLook.meta.appearance));

// ── живая правка имени земли ─────────────────────────────────────────
await page.locator("#closeStyle").click();
await page.waitForTimeout(300);
await page.locator(".land-row").nth(1).locator(".land-edit").click();
await page.waitForSelector("#editForm[data-kind=country]");
const labelText = () => page.locator('#atlas [data-country-label="sarti"] text').textContent();
const before = await labelText();
await page.locator("#editForm input[name=name]").fill("Златая Сартия");
await page.waitForTimeout(350);
check("имя видно на карте до сохранения", (await labelText()) === "Златая Сартия", await labelText());
await page.locator("#editForm input[name=color]").fill("#c98a1e");
await page.waitForTimeout(300);
check("цвет земли тоже живой", (await page.locator('#atlas .land-shape[data-country="sarti"]').getAttribute("fill")) === "#c98a1e");
await page.screenshot({ path: `${OUT}/style-06-rename-live.png`, animations: "disabled" });

await page.locator("#editForm [data-action=cancel-edit]").click();
await page.waitForTimeout(500);
check("отмена вернула имя", (await labelText()) === before, await labelText());

await page.locator(".land-row").nth(1).locator(".land-edit").click();
await page.locator("#editForm input[name=name]").fill("Златая Сартия");
await page.locator("#editForm input[name=fullName]").fill("Великая Златая Сартия");
await page.locator("#editForm button[type=submit]").click();
await page.waitForTimeout(1300);
check("сохранённое имя на карте", (await labelText()) === "Златая Сартия", await labelText());
check("имя в списке земель", (await page.locator(".land-row").nth(1).locator("b").textContent()) === "Златая Сартия");
check("полное имя в карточке", (await page.locator("#detail h1").textContent()).includes("Златая Сартия"));
await page.screenshot({ path: `${OUT}/style-07-renamed.png`, animations: "disabled" });

// вернуть исходное имя
await page.locator("#detail [data-action=edit-country]").click();
await page.locator("#editForm input[name=name]").fill("Сарти");
await page.locator("#editForm input[name=fullName]").fill("Великая Сарть");
await page.locator("#editForm button[type=submit]").click();
await page.waitForTimeout(1200);
check("исходное имя возвращено", (await labelText()) === before, await labelText());

// ── природа земли: луга, пустыня и обратно ───────────────────────────
const plantCount = () => page.evaluate(() => {
  const counts = { dune: 0, cactus: 0, grass: 0 };
  for (const use of document.querySelectorAll("#fmg-base #terrain use")) {
    const type = /relief-[a-z]+-(.+)-\d+$/.exec(use.getAttribute("href") || "")?.[1];
    if (type in counts) counts[type] += 1;
  }
  return counts;
});
await page.locator(".land-row").nth(1).locator(".land-edit").click();
await page.waitForSelector("#editForm[data-kind=country]");
const terrainField = page.locator("#editForm select[name=terrain]");
check("природа Сарти — луга", (await terrainField.inputValue()) === "meadow", await terrainField.inputValue());
const meadowPlants = await plantCount();
await terrainField.selectOption("desert");
await page.waitForTimeout(900);
const desertPlants = await plantCount();
check("пустыня растёт живьём", desertPlants.dune > meadowPlants.dune + 20 && desertPlants.cactus > meadowPlants.cactus + 20,
  JSON.stringify(desertPlants));
check("пятна почв под контуром земли", await page.evaluate(() =>
  document.querySelector('#terrain-lands [data-terrain="sarti"]')?.dataset.terrainKind) === "desert");
await page.screenshot({ path: `${OUT}/style-09-terrain-desert.png`, animations: "disabled" });
await terrainField.selectOption("meadow");
await page.waitForTimeout(900);
const backPlants = await plantCount();
check("луга возвращаются живьём", backPlants.dune === meadowPlants.dune && backPlants.grass === meadowPlants.grass,
  JSON.stringify(backPlants));
await page.locator("#editForm button[type=submit]").click();
await page.waitForTimeout(1400);
const terrainWorld = await (await fetch(`${BASE}/api/world`)).json();
check("природа записана в атлас", terrainWorld.countries.find(c => c.id === "sarti")?.terrain === "meadow");
check("природа видна в карточке", (await page.locator("#detail .facts").textContent()).includes("Зелёные луга"));
await page.screenshot({ path: `${OUT}/style-10-terrain-meadow.png`, animations: "disabled" });

// мобильная раскладка панели
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
await page.locator("#layersBtn").click();
await page.waitForTimeout(600);
await page.emulateMedia({ reducedMotion: "reduce" }); // мерить без анимации раскрытия
await page.waitForTimeout(250);
const box = await page.locator("#layersPop").boundingBox();
await page.emulateMedia({ reducedMotion: null });
check("панель помещается в телефон", box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844, JSON.stringify(box));
await page.screenshot({ path: `${OUT}/style-08-mobile.png`, animations: "disabled" });

log("\nproblems:", problems.length ? problems : "none");
log("failures:", failures.length ? failures : "none");
await browser.close();
if (failures.length || problems.length) process.exitCode = 1;