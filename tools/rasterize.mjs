import { readFileSync, writeFileSync } from "node:fs";
import { withBrowser } from "./lib.mjs";

const file = process.argv[2] || "tools/geography/fmg-base.svg";
const out = process.argv[3] || "tools/out/preview.png";
const width = +(process.argv[4] || 1600);
const svg = readFileSync(file, "utf8");

await withBrowser(async browser => {
  const page = await browser.newPage({ viewport: { width, height: Math.round(width * 0.5625) } });
  await page.setContent(`<body style="margin:0;background:#222">${svg}</body>`);
  await page.waitForTimeout(600);
  const el = await page.$("svg");
  await el.screenshot({ path: out });
  console.log("wrote", out);
});
