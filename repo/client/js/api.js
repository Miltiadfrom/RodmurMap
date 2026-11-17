let csrf = null;

export const setCsrf = token => {
  csrf = token;
};

async function request(method, url, body) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrf) headers["x-csrf-token"] = csrf;
  const res = await fetch(url, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(payload.error || `Ошибка ${res.status}`);
  return payload;
}

export const api = {
  world: () => request("GET", "/api/world"),
  session: () => request("GET", "/api/session"),
  login: password => request("POST", "/api/login", { password }),
  logout: () => request("POST", "/api/logout", {}),
  changePassword: (current, next) => request("POST", "/api/password", { current, next }),
  patchMeta: patch => request("PATCH", "/api/meta", patch),
  patchCountry: (id, patch) => request("PATCH", `/api/countries/${id}`, patch),
  patchCity: (id, patch) => request("PATCH", `/api/cities/${id}`, patch),
  addCity: city => request("POST", "/api/cities", city),
  removeCity: id => request("DELETE", `/api/cities/${id}`, {}),
  addRoad: road => request("POST", "/api/roads", road),
  removeRoad: id => request("DELETE", `/api/roads/${encodeURIComponent(id)}`, {}),
  features: ops => request("POST", "/api/features", { ops }),
  patchBaseLabel: (kind, id, patch) => request("PATCH", `/api/labels/${kind}/${id}`, patch),
  history: () => request("GET", "/api/history"),
  restore: file => request("POST", "/api/restore", { file }),
  replaceWorld: world => request("PUT", "/api/world", world)
};
