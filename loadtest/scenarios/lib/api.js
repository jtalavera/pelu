// k6 helpers for the pelu API (docs/staging-env.md T7).
// LOG HYGIENE: this repo is public and so are its workflow logs. Never log request/response
// bodies, tokens or user e-mails — only status codes and endpoint names.
import http from "k6/http";
import { check } from "k6";

export const BASE_URL = (__ENV.BASE_URL || "").replace(/\/+$/, "");

/** 2xx, plus 409 (slot conflicts, duplicate submits) which is normal behaviour, not an error. */
export const OK_OR_CONFLICT = http.expectedStatuses({ min: 200, max: 299 }, 409);

export function json(res) {
  try {
    return res.json();
  } catch (_) {
    return null;
  }
}

function params(token, name, extra = {}) {
  return {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    tags: { name },
    ...extra,
  };
}

export function get(token, path, name, extra) {
  const res = http.get(`${BASE_URL}${path}`, params(token, name, extra));
  check(res, { [`${name} ok`]: (r) => r.status >= 200 && r.status < 300 });
  return res;
}

export function post(token, path, body, name, extra) {
  const res = http.post(`${BASE_URL}${path}`, body === undefined ? null : JSON.stringify(body), params(token, name, extra));
  check(res, { [`${name} ok`]: (r) => (r.status >= 200 && r.status < 300) || r.status === 409 });
  return res;
}

export function put(token, path, body, name, extra) {
  const res = http.put(`${BASE_URL}${path}`, JSON.stringify(body), params(token, name, extra));
  check(res, { [`${name} ok`]: (r) => (r.status >= 200 && r.status < 300) || r.status === 409 });
  return res;
}

export function login(email, password) {
  const res = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({ email, password }), {
    headers: { "Content-Type": "application/json" },
    tags: { name: "auth_login" },
  });
  check(res, { "auth_login ok": (r) => r.status === 200 });
  const body = json(res);
  return body ? body.accessToken : null;
}

export function refresh(token) {
  const res = post(token, "/api/auth/refresh", undefined, "auth_refresh");
  const body = json(res);
  return (body && body.accessToken) || token;
}

export const isoDate = (d) => d.toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
