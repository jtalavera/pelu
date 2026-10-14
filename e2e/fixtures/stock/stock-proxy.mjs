// Stock cross-system suite: a tiny reverse proxy pelu talks to instead of Stock directly, so a spec
// can simulate "Stock is down" (connection refused-like 503) or inject a non-retryable 400 for the
// next N calls. Control: POST /__proxy {"mode":"up"|"down"|"fail400","count":N}; GET /__proxy.
import http from "node:http";

const listenPort = Number(process.env.STOCK_PROXY_PORT ?? 8091);
const target = new URL(process.env.STOCK_PROXY_TARGET ?? "http://127.0.0.1:8090");

let mode = "up";
let remaining = 0;
let forwarded = 0;

function control(req, res) {
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const cmd = body ? JSON.parse(body) : {};
      mode = cmd.mode ?? "up";
      remaining = Number(cmd.count ?? 0);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ mode, remaining, forwarded }));
    });
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ mode, remaining, forwarded }));
}

const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/__proxy")) {
    control(req, res);
    return;
  }
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"status":"UP"}');
    return;
  }
  const isToken = req.url?.startsWith("/oauth/token");
  if (mode === "down") {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end('{"error":"STOCK_DOWN_SIMULATED"}');
    return;
  }
  if (mode === "fail400" && !isToken && remaining > 0) {
    remaining -= 1;
    if (remaining === 0) mode = "up";
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end('{"error":"INVALID_REQUEST_SIMULATED"}');
    return;
  }
  forwarded += 1;
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `${target.hostname}:${target.port}` },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
    res.end('{"error":"STOCK_UPSTREAM_ERROR"}');
  });
  req.pipe(upstream);
});

server.listen(listenPort, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[stock-proxy] :${listenPort} → ${target.origin}`);
});
