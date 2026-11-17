// Веб-версия атласа «Повесть о Родмуре»: статика для посетителей, запись — только для хранителя.
import "./env.mjs";
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync, readFileSync } from "node:fs";
import { join, normalize, extname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { getWorld, commit, listHistory, readHistory, relinkRoads, restatCountries, applyFeatureOps, normalizeFeatures } from "./store.mjs";
import * as auth from "./auth.mjs";
import * as validate from "./validate.mjs";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = resolve(process.env.RODMUR_CLIENT_DIR || "client");
const MAX_BODY = 4 * 1024 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".mjs", ".json", ".svg", ".txt"]);

const json = (res, status, payload) => {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(body);
};

const fail = (res, status, message) => json(res, status, { error: message });

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Слишком большой запрос"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolvePromise({});
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Ожидался JSON"));
      }
    });
    req.on("error", reject);
  });
}

const clientIp = req =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "unknown";

const isSecure = req => (req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";

function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const target = resolve(join(ROOT, normalize(rel)));
  if (!target.startsWith(ROOT) || !existsSync(target) || !statSync(target).isFile()) {
    const fallback = join(ROOT, "index.html");
    if (pathname.startsWith("/api/")) return fail(res, 404, "Нет такого метода");
    return sendFile(req, res, fallback, ".html");
  }
  return sendFile(req, res, target, extname(target));
}

function sendFile(req, res, file, ext) {
  const stat = statSync(file);
  const etag = `W/"${stat.size}-${Number(stat.mtimeMs).toFixed(0)}"`;
  const headers = {
    "content-type": MIME[ext] || "application/octet-stream",
    "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    etag,
    "x-content-type-options": "nosniff"
  };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const acceptsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
  if (COMPRESSIBLE.has(ext) && acceptsGzip && stat.size > 1024) {
    const body = gzipSync(readFileSync(file), { level: 6 });
    res.writeHead(200, { ...headers, "content-encoding": "gzip", "content-length": body.length, vary: "Accept-Encoding" });
    return res.end(body);
  }
  res.writeHead(200, { ...headers, "content-length": stat.size });
  createReadStream(file).pipe(res);
}

/** Мутация: сессия + CSRF + проверкаOrigin, затем одна запись в хранилище. */
async function guarded(req, res, handler) {
  const cookies = auth.parseCookies(req.headers.cookie);
  const session = auth.sessionOf(cookies.rodmur_sid);
  if (!session) return fail(res, 401, "Требуется вход хранителя");
  if (!auth.csrfOk(session, req.headers["x-csrf-token"])) return fail(res, 403, "Неверный токен CSRF");
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return fail(res, 403, "Чужой источник запроса");
    } catch {
      return fail(res, 403, "Некорректный источник запроса");
    }
  }
  const body = await readBody(req);
  const world = handler(body, session);
  return json(res, 200, { ok: true, world });
}

const routes = {
  "GET /api/world": (req, res) => json(res, 200, getWorld()),

  "GET /api/session": (req, res) => {
    const session = auth.sessionOf(auth.parseCookies(req.headers.cookie).rodmur_sid);
    json(res, 200, { admin: Boolean(session), csrf: session?.csrf ?? null });
  },

  "GET /api/history": (req, res) => {
    const session = auth.sessionOf(auth.parseCookies(req.headers.cookie).rodmur_sid);
    if (!session) return fail(res, 401, "Требуется вход хранителя");
    json(res, 200, { history: listHistory() });
  },

  "GET /api/export": (req, res) => {
    const world = getWorld();
    const body = Buffer.from(JSON.stringify(world, null, 1));
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="rodmur-world-r${world.meta.revision}.json"`,
      "content-length": body.length
    });
    res.end(body);
  },

  "GET /healthz": (req, res) => json(res, 200, { ok: true, revision: getWorld().meta.revision }),

  "POST /api/login": async (req, res) => {
    const ip = clientIp(req);
    const allowed = auth.loginAllowed(ip);
    if (!allowed.ok) return fail(res, 429, `Слишком много попыток. Повторите через ${allowed.retryIn} с`);
    const body = await readBody(req);
    if (!auth.passwordMatches(body.password)) {
      auth.noteFailure(ip);
      return fail(res, 401, "Неверный пароль хранителя");
    }
    auth.clearFailures(ip);
    const { token, csrf } = auth.createSession();
    res.setHeader("set-cookie", auth.sessionCookie(token, isSecure(req)));
    json(res, 200, { admin: true, csrf });
  },

  "POST /api/logout": async (req, res) => {
    const cookies = auth.parseCookies(req.headers.cookie);
    auth.destroySession(cookies.rodmur_sid);
    res.setHeader("set-cookie", "rodmur_sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
    json(res, 200, { admin: false });
  },

  "POST /api/password": (req, res) =>
    guarded(req, res, (body, session) => {
      session.keep = true;
      try {
        auth.changePassword(body.current, body.next);
      } finally {
        delete session.keep;
      }
      return getWorld();
    }),

  "PATCH /api/meta": (req, res) =>
    guarded(req, res, body => {
      const patch = validate.metaPatch(body);
      return commit(w => {
        if (patch.appearance) {
          patch.appearance = {
            ...(w.meta.appearance || {}),
            ...patch.appearance,
            layers: { ...(w.meta.appearance?.layers || {}), ...(patch.appearance.layers || {}) }
          };
        }
        Object.assign(w.meta, patch);
      });
    }),

  "PATCH /api/countries/:id": (req, res, id) =>
    guarded(req, res, body => {
      const world = getWorld();
      const country = world.countries.find(c => c.id === id);
      if (!country) throw new HttpError(404, "Земля не найдена");
      const patch = validate.countryPatch({ ...body, id }, world);
      return commit(w => Object.assign(w.countries.find(c => c.id === id), patch));
    }),

  "PATCH /api/cities/:id": (req, res, id) =>
    guarded(req, res, body => {
      const world = getWorld();
      if (!world.cities.some(c => c.id === id)) throw new HttpError(404, "Город не найден");
      const patch = validate.cityPatch(body, world);
      return commit(w => Object.assign(w.cities.find(c => c.id === id), patch));
    }),

  "POST /api/cities": (req, res) =>
    guarded(req, res, body => {
      const city = validate.newCity(body, getWorld());
      return commit(w => w.cities.push(city));
    }),

  "DELETE /api/cities/:id": (req, res, id) =>
    guarded(req, res, () => {
      const world = getWorld();
      if (!world.cities.some(c => c.id === id)) throw new HttpError(404, "Город не найден");
      return commit(w => {
        w.cities = w.cities.filter(c => c.id !== id);
        w.roads = w.roads.filter(r => r.from !== id && r.to !== id);
      });
    }),

  "POST /api/roads": (req, res) =>
    guarded(req, res, body => {
      const world = getWorld();
      const { from, to, kind = "trade", name = "" } = body;
      if (!world.cities.some(c => c.id === from) || !world.cities.some(c => c.id === to)) {
        throw new HttpError(400, "Оба конца пути должны быть городами");
      }
      if (!["royal", "trade", "sea"].includes(kind)) throw new HttpError(400, "Неизвестный тип пути");
      if (from === to) throw new HttpError(400, "Путь не может вести в себя");
      return commit(w => w.roads.push({ id: `${from}--${to}`, from, to, kind, name: String(name).slice(0, 80) }));
    }),

  "DELETE /api/roads/:id": (req, res, id) =>
    guarded(req, res, () => commit(w => {
      w.roads = w.roads.filter(r => r.id !== id);
    })),

  "POST /api/features": (req, res) =>
    guarded(req, res, body => {
      const ops = validate.featureOps(body, getWorld());
      return commit(w => applyFeatureOps(w, ops));
    }),

  "PATCH /api/labels/:kind/:id": (req, res, kind, id) =>
    guarded(req, res, body => {
      const world = getWorld();
      if (!(world[kind] || []).some(item => item.id === id)) throw new HttpError(404, "Подпись не найдена");
      const patch = validate.baseLabelPatch(kind, body, world);
      return commit(w => Object.assign(w[kind].find(item => item.id === id), patch));
    }),

  "PUT /api/world": (req, res) =>
    guarded(req, res, body => {
      const next = validate.wholeWorld(body);
      return commit(w => {
        for (const key of Object.keys(w)) delete w[key];
        Object.assign(w, next);
        normalizeFeatures(w);
        relinkRoads(w);
        restatCountries(w);
      });
    }),

  "POST /api/restore": (req, res) =>
    guarded(req, res, body => {
      const snapshot = validate.wholeWorld(readHistory(String(body.file || "")));
      return commit(w => {
        for (const key of Object.keys(w)) delete w[key];
        Object.assign(w, snapshot);
      });
    })
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function matchRoute(method, pathname) {
  const direct = routes[`${method} ${pathname}`];
  if (direct) return { handler: direct };
  for (const key of Object.keys(routes)) {
    const [m, pattern] = key.split(" ");
    if (m !== method || !pattern.includes(":")) continue;
    const parts = pattern.split("/");
    const given = pathname.split("/");
    if (parts.length !== given.length) continue;
    const params = [];
    const ok = parts.every((part, i) => {
      if (part.startsWith(":")) {
        params.push(decodeURIComponent(given[i]));
        return true;
      }
      return part === given[i];
    });
    if (ok) return { handler: routes[key], params };
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  res.setHeader("referrer-policy", "same-origin");
  res.setHeader("x-content-type-options", "nosniff");

  try {
    if (pathname.startsWith("/api/") || pathname === "/healthz") {
      const route = matchRoute(req.method, pathname);
      if (!route) return fail(res, 404, "Нет такого метода");
      return await route.handler(req, res, ...(route.params || []));
    }
    if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "Метод не поддерживается");
    return serveStatic(req, res, pathname);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    if (status >= 500) console.error(error);
    return fail(res, status, error.message || "Ошибка запроса");
  }
});

getWorld();
auth.initAuth(line => console.log(line));
server.listen(PORT, HOST, () => {
  console.log(`\n  Повесть о Родмуре — атлас мира`);
  console.log(`  http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}\n`);
});
