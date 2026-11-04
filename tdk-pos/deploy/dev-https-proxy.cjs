/* eslint-disable @typescript-eslint/no-require-imports -- This utility runs directly as CommonJS under Node. */
/* Local-only development TLS front for a phone on the same Wi-Fi. */
const fs = require("node:fs");
const https = require("node:https");
const http = require("node:http");
const path = require("node:path");

const certDirectory = path.join(process.env.LOCALAPPDATA || "", "TDKON", "DevHttps");
if (!process.env.LOCALAPPDATA) throw new Error("LOCALAPPDATA is required to load the local development certificate.");
const listenHost = process.env.DEV_HTTPS_LISTEN_HOST || "192.168.0.54";
const listenPort = Number(process.env.DEV_HTTPS_PORT || 3000);
const upstreamHost = "127.0.0.1";
const upstreamPort = Number(process.env.DEV_HTTPS_UPSTREAM_PORT || 3001);
const password = fs.readFileSync(path.join(certDirectory, "pfx-password.txt"), "utf8").trim();

const server = https.createServer({
  pfx: fs.readFileSync(path.join(certDirectory, "server.pfx")),
  passphrase: password,
  minVersion: "TLSv1.2",
}, (request, response) => {
  const headers = { ...request.headers, host: `localhost:${upstreamPort}` };
  if (request.headers.origin) headers.origin = `https://localhost:${upstreamPort}`;
  for (const name of Object.keys(headers)) {
    if (name.startsWith("x-tdk-")) delete headers[name];
  }

  const upstream = http.request({
    host: upstreamHost,
    port: upstreamPort,
    method: request.method,
    path: request.url,
    headers,
  }, upstreamResponse => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  request.on("aborted", () => upstream.destroy());
  response.on("close", () => { if (!response.writableEnded) upstream.destroy(); });
  response.on("error", () => upstream.destroy());
  upstream.on("error", error => {
    console.error("Development app upstream unavailable", { code: error.code });
    if (!response.headersSent) response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("TDKON development server is not running on loopback port 3001.");
  });
  request.pipe(upstream);
});

server.on("upgrade", (request, socket, head) => {
  const headers = { ...request.headers, host: `localhost:${upstreamPort}` };
  if (request.headers.origin) headers.origin = `https://localhost:${upstreamPort}`;
  for (const name of Object.keys(headers)) {
    if (name.startsWith("x-tdk-")) delete headers[name];
  }
  const upstream = http.request({
    host: upstreamHost,
    port: upstreamPort,
    method: request.method,
    path: request.url,
    headers,
  });
  socket.on("error", () => upstream.destroy());
  upstream.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
    socket.on("error", () => upstreamSocket.destroy());
    upstreamSocket.on("error", () => socket.destroy());
    const lines = [`HTTP/1.1 ${upstreamResponse.statusCode} ${upstreamResponse.statusMessage}`];
    for (const [name, value] of Object.entries(upstreamResponse.headers)) {
      if (Array.isArray(value)) for (const item of value) lines.push(`${name}: ${item}`);
      else if (value !== undefined) lines.push(`${name}: ${value}`);
    }
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    socket.pipe(upstreamSocket).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  upstream.end();
});

server.on("tlsClientError", error => {
  if (error.code !== "ECONNRESET") console.warn("Development TLS client closed early", { code: error.code });
});

server.listen(listenPort, listenHost, () => {
  console.log(`TDKON development HTTPS: https://${listenHost}:${listenPort}/tdkhos`);
  console.log(`TLS front forwards to loopback-only http://${upstreamHost}:${upstreamPort}.`);
});
