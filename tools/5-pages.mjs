import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = "dist-pages";
rmSync(out, { recursive: true, force: true });
cpSync("client", out, { recursive: true });
rmSync(join(out, "admin.html"), { force: true }); // мастерская хранителя — только локально

// Статические "эндпоинты": /api/world и /api/export отдают тот же JSON.
mkdirSync(join(out, "api"), { recursive: true });
const world = readFileSync("data/world.json", "utf8");
writeFileSync(join(out, "api", "world"), world);
writeFileSync(join(out, "api", "export"), world);

// Сайт живёт в подпапке /RodmurMap/ — абсолютные пути меняем на относительные.
const api = join(out, "js", "api.js");
writeFileSync(api, readFileSync(api, "utf8").replaceAll("/api/", "api/"));

const html = join(out, "index.html");
writeFileSync(html, readFileSync(html, "utf8")
  .replaceAll('href="/api/export"', 'href="api/export"')
  .replaceAll('href="/"', 'href="./"'));

const css = join(out, "styles.css");
writeFileSync(css, readFileSync(css, "utf8").replaceAll("url(/", "url("));

console.log("Собрано:", out);