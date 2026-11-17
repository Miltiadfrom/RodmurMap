// Проверка атласа в браузере: посетитель и хранитель.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.ATLAS_URL || "http://127.0.0.1:8080";
const PASSWORD = process.env.RODMUR_ADMIN_PASSWORD || "pzVuNBI4GjyF";
const OUT = "tools/out";
mkdirSync(OUT, { recursive: true });

const flags = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=700"];
const problems = [];
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ args: flags });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on("console", m => { if (m.type() === "error" && !m.text().includes("401")) problems.push(`console: ${m.text()}`); });
page.on("pageerror", e => problems.push(`pageerror: ${e.message}`));
page.on("requestfailed", r => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
page.on("dialog", d => d.accept());

await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("#loading", { state: "hidden", timeout: 60000 });
await page.waitForTimeout(900);
log("boot ok; cities on map:", await page.locator("#cities .city-row").count(), "lands:", await page.locator("#lands .land").count());
log("svg city nodes:", await page.locator("#atlas .city-node").count(), "labels:", await page.locator("#atlas .city-label").count());
await page.screenshot({ path: `${OUT}/qa-01-desktop.png` });

// Выбор земли
await page.locator("#lands .land").nth(1).click();
await page.waitForTimeout(800);
log("country detail:", await page.locator("#detail h1").textContent(), "| facts:", await page.locator("#detail .facts div").count());
await page.screenshot({ path: `${OUT}/qa-02-country.png` });

// Выбор города из списка земли
await page.locator("#detail .link-list button").first().click();
await page.waitForTimeout(900);
log("city detail:", await page.locator("#detail h1").textContent(), "| roads:", await page.locator("#detail .road-row").count());
await page.screenshot({ path: `${OUT}/qa-03-city.png` });

// Поиск
await page.fill("#search", "Сарти");
await page.waitForTimeout(400);
log("search rows:", await page.locator("#cities .city-row").count(), "visible map nodes:", await page.locator("#atlas .city-node:visible").count());
await page.screenshot({ path: `${OUT}/qa-04-search.png` });
await page.fill("#search", "");
await page.waitForTimeout(350);

// Фильтр «Порты»
await page.locator("#filters .chip", { hasText: "Порты" }).click();
await page.waitForTimeout(400);
log("ports rows:", await page.locator("#cities .city-row").count(), "map visible:", await page.locator("#atlas .city-node:visible").count());
await page.locator("#filters .chip", { hasText: "Все" }).click();
await page.waitForTimeout(300);

// Наведение на список подсвечивает объект на карте
await page.locator("#cities .city-row").nth(4).hover();
await page.waitForTimeout(300);
log("hover peek nodes:", await page.locator("#atlas .city-node.peek").count());
await page.locator("#lands .land").nth(2).hover();
await page.waitForTimeout(300);
log("hover peek lands:", await page.locator("#atlas .land-shape.peek").count());
await page.mouse.move(760, 500);
await page.waitForTimeout(200);

// Масштаб
await page.locator("#detailClose").click();
await page.locator("#zoomIn").click();
await page.waitForTimeout(700);
log("scale after zoom:", await page.locator("#scaleLabel").textContent(), "labels visible:", await page.locator("#atlas .city-label:visible").count());
await page.screenshot({ path: `${OUT}/qa-05-zoom.png` });
await page.locator("#zoomFit").click();
await page.waitForTimeout(700);

// Оформление: панель, рельеф, слои
await page.locator("#layersBtn").click();
await page.waitForSelector("#layersPop:not([hidden])");
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/qa-06-layers.png` });
const reliefProbe = () => page.evaluate(() => {
  const g = document.querySelector("#fmg-base #terrain");
  const u = g.querySelectorAll("use")[12];
  return { set: g.dataset.reliefSet, count: g.querySelectorAll("use").length, w: +u.getAttribute("width"), bottom: +u.getAttribute("y") + +u.getAttribute("height") };
});
const reliefBoot = await reliefProbe();
await page.locator("#reliefScale").evaluate(n => { n.value = "160"; n.dispatchEvent(new Event("input", { bubbles: true })); });
await page.waitForTimeout(500);
const reliefBig = await reliefProbe();
const grew = Math.abs(reliefBig.w - reliefBoot.w * 1.6) < reliefBoot.w * 0.02 && Math.abs(reliefBig.bottom - reliefBoot.bottom) < 0.06;
log("relief:", reliefBoot.count, "знаков, набор", reliefBoot.set, "| крупность 160 % растит знак на месте:", grew);
if (!grew) problems.push(`relief scale moves the icon: ${JSON.stringify({ reliefBoot, reliefBig })}`);
await page.locator("#styleReset").click();
await page.waitForTimeout(400);
const roadsToggle = page.locator("#layerGrid .switch", { hasText: "Пути" });
await roadsToggle.click();
await page.waitForTimeout(250);
const roadsOff = await page.locator("#atlas #ov-roads").evaluate(n => getComputedStyle(n).display);
log("roads checked:", await roadsToggle.locator("input").isChecked(), "display:", roadsOff);
if (roadsOff !== "none") problems.push("слой путей не выключился");
await roadsToggle.click();
await page.waitForTimeout(250);
const roadsOn = await page.locator("#atlas #ov-roads").evaluate(n => getComputedStyle(n).display);
log("roads back:", roadsOn);
if (roadsOn === "none") problems.push("слой путей не вернулся");
const setTint = v => page.locator("#tintStrength").evaluate((n, value) => { n.value = String(value); n.dispatchEvent(new Event("input", { bubbles: true })); }, v);
await setTint(50);
await page.waitForTimeout(250);
const tintLabel = await page.locator("#tintValue").textContent();
const tintFill = await page.locator("#atlas .land-shape").first().getAttribute("fill-opacity");
log("tint:", tintLabel, tintFill);
if (tintLabel !== "50%" || tintFill !== "0.50") problems.push(`краски земель рассинхронизированы: ${tintLabel} / ${tintFill}`);
await setTint(26);
await page.keyboard.press("Escape");

// Публичная страница — без единого органа правки
const publicChrome = await page.evaluate(() => ({
  keeperBtn: !!document.querySelector("#keeperBtn"),
  editor: !!document.querySelector("#editor"),
  login: !!document.querySelector("#loginModal"),
  keeperPanel: !!document.querySelector("#keeperModal"),
  addCity: !!document.querySelector("#addCityBtn"),
  styleSave: !!document.querySelector("#styleSave"),
  editorScript: performance.getEntriesByType("resource").some(r => r.name.includes("editor.js"))
}));
log("public chrome:", JSON.stringify(publicChrome));
if (Object.values(publicChrome).some(Boolean)) problems.push("на публичной странице есть органы правки");

// Вход хранителя — отдельная страница мастерской
await page.goto(`${BASE}/admin`, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("#gateForm");
log("застава:", await page.locator("#gate h1").textContent(), "| атлас за заставой:", await page.locator("#atlas .city-node").count());
await page.screenshot({ path: `${OUT}/qa-14-gate.png` });
await page.fill("#gatePassword", "wrong-password");
await page.locator("#gateForm button[type=submit]").click();
await page.waitForTimeout(600);
log("bad login error:", await page.locator("#gateError").textContent());
await page.fill("#gatePassword", PASSWORD);
await page.locator("#gateForm button[type=submit]").click();
await page.waitForSelector("#loading", { state: "hidden", timeout: 60000 });
await page.waitForTimeout(1000);
log("keeper mode:", await page.locator("body").evaluate(n => n.classList.contains("keeper")), "| btn:", await page.locator("#keeperBtnLabel").textContent());
// дальше сценарий про карточки и панель — верстак редактора закрываем
if (await page.locator("body").evaluate(n => n.classList.contains("editing"))) {
  await page.locator("#editorExit").click();
  await page.waitForTimeout(600);
}

// Правка города
await page.locator("#cities .city-row").first().click();
await page.waitForTimeout(800);
const cityName = await page.locator("#detail h1").textContent();
await page.locator("#detail [data-action=edit-city]").click();
await page.waitForSelector("#editForm");
await page.locator("#editForm textarea[name=summary]").fill("Проверка пера хранителя: гавань северных ветров.");
await page.locator("#editForm button[type=submit]").click();
await page.waitForTimeout(1200);
log("after save lede:", (await page.locator("#detail .full-name").textContent())?.slice(0, 60));
log("toast:", await page.locator("#toasts .toast").last().textContent().catch(() => "—"));
await page.screenshot({ path: `${OUT}/qa-07-keeper-edit.png` });

// Прокладка и удаление пути
await page.locator("#roadForm select[name=to]").selectOption({ index: 3 });
await page.locator("#roadForm button[type=submit]").click();
await page.waitForTimeout(1000);
log("roads now:", await page.locator("#detail .road-row").count());
await page.locator("#detail .road-row [data-del-road]").last().click();
await page.waitForTimeout(1000);
log("roads after delete:", await page.locator("#detail .road-row").count());

// Постановка нового города
await page.locator("#zoomFit").click();
await page.waitForTimeout(800);
await page.locator("#addCityBtn").click();
await page.waitForTimeout(300);
log("place banner:", await page.locator("#placeMode").isVisible());
await page.locator("#atlas").click({ position: { x: 700, y: 430 } });
await page.waitForSelector("#editForm");
await page.locator("#editForm input[name=name]").fill("Пробный Острог");
await page.waitForTimeout(200);
log("auto id:", await page.locator("#editForm input[name=id]").inputValue());
await page.locator("#editForm select[name=country]").selectOption("sarti");
await page.locator("#editForm button[type=submit]").click();
await page.waitForTimeout(1200);
log("created:", await page.locator("#detail h1").textContent(), "| total rows:", await page.locator("#cities .city-row").count());
await page.screenshot({ path: `${OUT}/qa-08-new-city.png` });

// Перетаскивание города
const node = page.locator("#atlas .city-node[data-city=probnyy-ostrog]");
const before = await node.getAttribute("transform");
const box = await node.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(1200);
const after = await page.locator("#atlas .city-node[data-city=probnyy-ostrog]").getAttribute("transform");
log("drag:", before, "->", after);

// Удаление пробного города
await page.locator("#detail [data-action=delete-city]").click();
await page.waitForTimeout(1200);
log("after delete rows:", await page.locator("#cities .city-row").count());

// Отмена удаления
await page.locator("#toasts .toast button", { hasText: "Вернуть" }).click();
await page.waitForTimeout(1400);
log("after undo rows:", await page.locator("#cities .city-row").count());
await page.fill("#search", "Пробный");
await page.waitForTimeout(400);
await page.locator("#cities .city-row").first().click();
await page.waitForTimeout(700);
await page.locator("#detail [data-action=delete-city]").click();
await page.waitForTimeout(1200);
await page.fill("#search", "");
await page.waitForTimeout(400);
log("after re-delete rows:", await page.locator("#cities .city-row").count());

// Панель хранителя
await page.locator("#keeperBtn").click();
await page.waitForSelector("#keeperModal[open]");
await page.waitForTimeout(600);
log("history rows:", await page.locator("#historyList .history-row").count());
await page.screenshot({ path: `${OUT}/qa-09-keeper-panel.png` });
await page.locator("#keeperModal .tab[data-tab=meta]").click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${OUT}/qa-10-keeper-meta.png` });
await page.locator("#keeperModal .tab[data-tab=data]").click();
await page.waitForTimeout(200);
await page.locator("#keeperModal [data-close]").click();
await page.waitForTimeout(300);

// Выход
await page.locator("#keeperBtn").click();
await page.waitForSelector("#keeperModal[open]");
await page.locator("#logoutBtn").click();
await page.waitForSelector("#gateForm", { timeout: 30000 });
await page.waitForTimeout(600);
log("after logout — застава:", await page.locator("body").evaluate(n => n.classList.contains("gated")),
  "| keeper class:", await page.locator("body").evaluate(n => n.classList.contains("keeper")));

// Мобильная раскладка публичного атласа
await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("#loading", { state: "hidden", timeout: 60000 });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/qa-11-mobile.png` });
await page.locator("#toggleSidebar").click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/qa-12-mobile-drawer.png` });
await page.locator("#cities .city-row").first().click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/qa-13-mobile-detail.png` });

log("\nproblems:", problems.length ? problems : "none");
await browser.close();
if (problems.length) process.exitCode = 1;
