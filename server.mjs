import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REAL_ROOT = await realpath(ROOT);
const NOT_FOUND_PAGE = await readFile(path.join(ROOT, "404.html"));
const HOST = process.env.HOST || "127.0.0.1";
const PORT = parsePort(process.env.PORT, 4173);

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".icc", "application/vnd.iccprofile"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
]);

const server = createServer(async (request, response) => {
  setSecurityHeaders(response);
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    return sendText(response, 405, "Method not allowed");
  }

  try {
    const url = new URL(request.url || "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    if (pathname.includes("\\") || pathname.includes("\0")) return sendText(response, 400, "Invalid path");

    const segments = pathname.split("/").filter(Boolean);
    if (segments.some((segment) => segment === "." || segment === ".." || segment.startsWith("."))) {
      return sendNotFound(response, request.method);
    }

    const contentType = CONTENT_TYPES.get(path.extname(pathname).toLowerCase());
    if (!contentType) return sendNotFound(response, request.method);
    const candidate = path.resolve(ROOT, `.${pathname}`);
    if (!isInside(ROOT, candidate)) return sendText(response, 404, "Not found");

    let resolved;
    let details;
    try {
      [resolved, details] = await Promise.all([realpath(candidate), stat(candidate)]);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        return sendNotFound(response, request.method);
      }
      throw error;
    }
    if (!isInside(REAL_ROOT, resolved) || !details.isFile()) {
      return sendNotFound(response, request.method);
    }

    response.statusCode = 200;
    response.setHeader("Content-Type", contentType);
    response.setHeader("Content-Length", details.size);
    response.setHeader("Cache-Control", "no-cache");
    if (pathname === "/sw.js") response.setHeader("Service-Worker-Allowed", "/");
    if (request.method === "HEAD") return response.end();

    const stream = createReadStream(resolved);
    stream.on("error", (error) => response.destroy(error));
    stream.pipe(response);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendText(response, 500, "Internal server error");
    else response.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ShinyPic is running at http://${HOST}:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  response.setHeader(
    "Permissions-Policy",
    "accelerometer=(), autoplay=(), browsing-topics=(), camera=(self), display-capture=(), encrypted-media=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), microphone=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), web-share=(self), xr-spatial-tracking=()",
  );
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; font-src 'none'; media-src 'none'; frame-src 'none'",
  );
}

function sendText(response, status, message) {
  const body = `${message}\n`;
  response.statusCode = status;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function sendNotFound(response, method) {
  response.statusCode = 404;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Content-Length", NOT_FOUND_PAGE.byteLength);
  response.setHeader("Cache-Control", "no-cache");
  response.end(method === "HEAD" ? undefined : NOT_FOUND_PAGE);
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parsePort(value, fallback) {
  if (value === undefined) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  return port;
}
