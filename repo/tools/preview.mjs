// Снимок атласа для README: PNG из QA → компактный JPEG.
import { readFileSync, writeFileSync } from "node:fs";
import { withBrowser } from "./lib.mjs";

const src = process.argv[2] || "tools/out/qa-01-desktop.png";
const out = process.argv[3] || "docs/atlas-preview.jpg";
const width = +(process.argv[4] || 1280);
const data = readFileSync(src).toString("base64");

await withBrowser(async browser => {
  const page = await browser.newPage();
  const jpeg = await page.evaluate(async ({ data, width }) => {
    const img = new Image();
    img.src = "data:image/png;base64," + data;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.round((img.height / img.width) * width);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.86).split(",")[1];
  }, { data, width });
  writeFileSync(out, Buffer.from(jpeg, "base64"));
  console.log("wrote", out, (Buffer.from(jpeg, "base64").length / 1024).toFixed(0), "kB");
});
