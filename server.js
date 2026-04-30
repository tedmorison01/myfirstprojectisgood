const http = require("http");
const https = require("https");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

const STRIP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

const server = http.createServer((req, res) => {
  if (!TARGET_BASE) {
    res.writeHead(500);
    res.end("Misconfigured: TARGET_DOMAIN is not set");
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(TARGET_BASE + req.url);
  } catch (err) {
    res.writeHead(400);
    res.end("Bad Request: Invalid URL");
    return;
  }

  const outHeaders = {};
  let clientIp = null;

  for (const [key, value] of Object.entries(req.headers)) {
    const k = key.toLowerCase();
    if (STRIP_HEADERS.has(k)) continue;
    if (k.startsWith("x-nf-")) continue;
    if (k.startsWith("x-netlify-")) continue;
    if (k === "x-real-ip") {
      clientIp = value;
      continue;
    }
    if (k === "x-forwarded-for") {
      if (!clientIp) clientIp = value;
      continue;
    }
    outHeaders[k] = value;
  }

  if (clientIp) outHeaders["x-forwarded-for"] = clientIp;

  const lib = targetUrl.protocol === "https:" ? https : http;

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: outHeaders,
  };

  const proxyReq = lib.request(options, (proxyRes) => {
    const responseHeaders = {};
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      if (key.toLowerCase() === "transfer-encoding") continue;
      responseHeaders[key] = value;
    }
    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502);
    }
    res.end("Bad Gateway: Relay Failed");
  });

  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
});

server.listen(PORT, () => {
  console.log(`Relay server listening on port ${PORT}`);
  if (TARGET_BASE) {
    console.log(`Proxying requests to: ${TARGET_BASE}`);
  } else {
    console.warn("WARNING: TARGET_DOMAIN environment variable is not set");
  }
});
