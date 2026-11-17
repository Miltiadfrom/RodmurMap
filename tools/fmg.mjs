// Генератор карт (форк Azgaar FMG) нужен только на этапе сборки подложки.
// Здесь он появляется сам: клонируется в .cache/fmg на закрепждённом коммите и собирается.
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { join, extname, resolve, normalize } from "node:path";

const REPO = process.env.FMG_REPO || "https://github.com/Miltiadfrom/Rodmur_Map.git";
const COMMIT = process.env.FMG_COMMIT || "7886251";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon"
};

function run(command, args, cwd, env) {
  console.log(`[fmg] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, env: env || process.env, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) throw new Error(`Команда завершилась с кодом ${result.status}: ${command}`);
}

/** Каталог с собранной FMG: свой (FMG_DIR), кэш проекта или свежая сборка из репозитория. */
export function ensureFmg() {
  const dir = resolve(process.env.FMG_DIR || ".cache/fmg");
  const dist = join(dir, "dist");
  if (existsSync(join(dist, "index.html"))) return { dir, dist };

  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(dir, { recursive: true });
    run("git", ["init", "--quiet"], dir);
    run("git", ["remote", "add", "origin", REPO], dir);
  }
  run("git", ["fetch", "--depth", "1", "origin", COMMIT], dir);
  run("git", ["checkout", "--quiet", "FETCH_HEAD"], dir);
  run("npm", ["ci", "--no-audit", "--no-fund"], dir);
  run("npx", ["vite", "build"], dir, { ...process.env, NETLIFY: "1" });
  if (!existsSync(join(dist, "index.html"))) throw new Error("Сборка FMG не дала dist/index.html");
  return { dir, dist };
}

/** Короткоживущий статический сервер для страницы генератора. */
export function serveDist(dist, port = Number(process.env.FMG_PORT || 5174)) {
  const root = resolve(dist);
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = resolve(join(root, normalize(rel)));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise(resolvePromise => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolvePromise({
        url: `http://127.0.0.1:${address.port}/`,
        close: () => new Promise(done => server.close(done))
      });
    });
  });
}
