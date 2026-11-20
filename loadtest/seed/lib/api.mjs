// Minimal JSON client for the pelu REST API (Node 20 fetch). Never logs bodies or tokens.

export class ApiError extends Error {
  constructor(method, path, status, code) {
    super(`${method} ${path} → HTTP ${status}${code ? ` (${code})` : ""}`);
    this.status = status;
    this.code = code;
  }
}

export function createApi(baseUrl) {
  const base = baseUrl.replace(/\/+$/, "");

  async function call(method, path, { body, token, retries = 4 } = {}) {
    for (let attempt = 1; ; attempt++) {
      let res;
      try {
        res = await fetch(`${base}${path}`, {
          method,
          headers: {
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        if (attempt >= retries) throw err;
        await sleep(2000 * attempt);
        continue;
      }
      // 5-DTU Basic DB / single replica: back off on overload instead of failing the whole run.
      if ((res.status === 429 || res.status >= 502) && attempt < retries) {
        await sleep(3000 * attempt);
        continue;
      }
      const text = await res.text();
      const json = text ? safeJson(text) : null;
      if (!res.ok) {
        throw new ApiError(method, path, res.status, json?.code ?? json?.error ?? json?.message);
      }
      return json;
    }
  }

  return {
    get: (path, opts) => call("GET", path, opts),
    post: (path, body, opts) => call("POST", path, { ...opts, body }),
    put: (path, body, opts) => call("PUT", path, { ...opts, body }),
    patch: (path, body, opts) => call("PATCH", path, { ...opts, body }),
    async login(email, password) {
      const res = await call("POST", "/api/auth/login", { body: { email, password } });
      return res.accessToken;
    },
  };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** List endpoints return either an array or a Spring page. */
export const rows = (r) => (Array.isArray(r) ? r : (r?.content ?? r?.items ?? []));
