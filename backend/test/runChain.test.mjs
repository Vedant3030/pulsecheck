import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { runChain } from "../src/lib/chainRunner.js";
import { evaluateAssertions } from "../src/lib/assertions.js";

function startMock(routes) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const route = routes[`${req.method} ${req.url.split("?")[0]}`] || routes.default;
      if (!route) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end("{}");
        return;
      }
      route(req, body, res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function json(res, code, obj, headers = {}) {
  res.writeHead(code, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(obj));
}

// Deps against the mock with direct loopback URLs (runChain validates URL
// templates before requesting, so no placeholder scheme is used). No guard
// here by design — the guard lives in the worker/backend request impls,
// and loopback could never pass it. Mirrors workerStepRequest sequencing.
function mockDeps(base) {
  return {
    evaluate: (assertions, ctx) => evaluateAssertions(assertions, ctx),
    request: async ({ method, url, headers, body }, timeoutMs) => {
      const t0 = Date.now();
      const r = await fetch(url, {
        method, headers, body: body || undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await r.text();
      const hs = {};
      r.headers.forEach((v, k) => { hs[k] = v; });
      return { statusCode: r.status, headers: hs, bodyText: text, wasTruncated: false, responseTimeMs: Date.now() - t0 };
    },
  };
}

const U = (port, path) => `http://127.0.0.1:${port}${path}`;

test("runChain: all-green with extraction + substitution", async () => {
  const { server, port } = await startMock({
    "POST /login": (req, body, res) => json(res, 200, { data: { token: "tok-123" } }),
    "GET /me": (req, body, res) => {
      if (req.headers.authorization !== "Bearer tok-123") return json(res, 401, {});
      json(res, 200, { ok: true });
    },
  });
  try {
    const steps = [
      { order: 0, name: "login", method: "POST", url: U(port, "/login"), requestBody: '{"u":"a"}', requestHeaders: {}, authType: null, authHeaderName: null, secret: null, extracts: [{ variable: "token", source: "body", path: "$.data.token" }], assertions: [] },
      { order: 1, name: "me", method: "GET", url: U(port, "/me"), requestBody: null, requestHeaders: {}, authType: "bearer", authHeaderName: null, secret: "{{token}}", extracts: [], assertions: [{ type: "STATUS_CODE", field: null, operator: "EQUALS", expectedValue: "200" }] },
    ];
    const r = await runChain(steps, mockDeps(`http://127.0.0.1:${port}`));
    assert.equal(r.status, "up");
    assert.equal(r.failedStepIndex, null);
    assert.equal(r.stepResults.length, 2);
    assert.deepEqual(r.stepResults[0].extracts, [{ variable: "token", extracted: true }]);
  } finally {
    server.close();
  }
});

test("runChain: step-2 failure stops the chain", async () => {
  let step3Hit = false;
  const { server, port } = await startMock({
    "GET /one": (req, body, res) => json(res, 200, { ok: true }),
    "GET /two": (req, body, res) => json(res, 500, { err: true }),
    "GET /three": (req, body, res) => { step3Hit = true; json(res, 200, {}); },
  });
  try {
    const mk = (order, name, path) => ({ order, name, method: "GET", url: U(port, path), requestBody: null, requestHeaders: {}, authType: null, authHeaderName: null, secret: null, extracts: [], assertions: [] });
    const r = await runChain([mk(0, "one", "/one"), mk(1, "two", "/two"), mk(2, "three", "/three")], mockDeps(`http://127.0.0.1:${port}`));
    assert.equal(r.status, "down");
    assert.equal(r.failedStepIndex, 1);
    assert.equal(r.stepResults.length, 2);
    assert.equal(r.stepResults[1].statusCode, 500);
    assert.equal(step3Hit, false);
  } finally {
    server.close();
  }
});

test("runChain: extraction failure fails the step", async () => {
  const { server, port } = await startMock({
    "GET /data": (req, body, res) => json(res, 200, { wrong: "shape" }),
  });
  try {
    const steps = [{ order: 0, name: "data", method: "GET", url: U(port, "/data"), requestBody: null, requestHeaders: {}, authType: null, authHeaderName: null, secret: null, extracts: [{ variable: "t", source: "body", path: "$.missing.deep" }], assertions: [] }];
    const r = await runChain(steps, mockDeps(`http://127.0.0.1:${port}`));
    assert.equal(r.status, "down");
    assert.match(r.stepResults[0].error, /not found/);
  } finally {
    server.close();
  }
});

test("runChain: per-step timeout", async () => {
  const { server, port } = await startMock({
    "GET /slow": (req, body, res) => setTimeout(() => json(res, 200, {}), 3000),
  });
  const origRequest = mockDeps(`http://127.0.0.1:${port}`).request;
  try {
    const steps = [{ order: 0, name: "slow", method: "GET", url: U(port, "/slow"), requestBody: null, requestHeaders: {}, authType: null, authHeaderName: null, secret: null, extracts: [], assertions: [] }];
    const r = await runChain(steps, {
      evaluate: (a, c) => evaluateAssertions(a, c),
      request: (req) => origRequest(req, 500),
    });
    assert.equal(r.status, "down");
    assert.match(r.stepResults[0].error || "", /timed out|abort/i);
  } finally {
    server.close();
  }
});

test("runChain: rejects empty / oversize chains", async () => {
  const deps = mockDeps("http://127.0.0.1:9");
  await assert.rejects(() => runChain([], deps), /1 to 5 steps/);
  await assert.rejects(() => runChain(new Array(6).fill({ order: 0, name: "x", url: "http://127.0.0.1:9/" }), deps), /1 to 5 steps/);
});
