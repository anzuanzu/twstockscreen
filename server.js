const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const SCAN_URL = "https://scanner.tradingview.com/taiwan/scan";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, error.code === "ENOENT" ? 404 : 500, {
        message: error.code === "ENOENT" ? "Not found" : "File read failed",
      });
      return;
    }

    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  });
}

async function proxyTaiwanScan(req, res) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  const response = await fetch(SCAN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const text = await response.text();

  res.writeHead(response.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/taiwan-scan") {
      await proxyTaiwanScan(req, res);
      return;
    }

    const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.join(ROOT, path.normalize(requestedPath));

    if (!filePath.startsWith(ROOT)) {
      sendJson(res, 403, { message: "Forbidden" });
      return;
    }

    sendFile(res, filePath);
  } catch (error) {
    sendJson(res, 500, { message: error.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://127.0.0.1:${PORT}`);
});
