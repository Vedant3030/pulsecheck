import test from "node:test";
import assert from "node:assert/strict";
import {
  walkPath, substituteVars, validateUrlTemplate, extractValue,
  isValidExtractPath, referencedVars, ChainError,
} from "../src/lib/chainRunner.js";

test("walker: valid dot path", () => {
  assert.deepEqual(walkPath({ data: { token: "abc" } }, "$.data.token"), { found: true, value: "abc" });
});

test("walker: array index", () => {
  assert.deepEqual(walkPath({ items: [{ id: 1 }, { id: 2 }] }, "$.items[1].id"), { found: true, value: 2 });
});

test("walker: missing key", () => {
  assert.deepEqual(walkPath({ a: 1 }, "$.b.c"), { found: false });
});

test("walker: index out of bounds / non-array", () => {
  assert.deepEqual(walkPath({ items: [1] }, "$.items[5]"), { found: false });
  assert.deepEqual(walkPath({ items: 7 }, "$.items[0]"), { found: false });
});

test("walker: __proto__ blocked", () => {
  assert.deepEqual(walkPath({}, "$.__proto__.x"), { found: false });
  assert.deepEqual(walkPath({ a: 1 }, "$.a.__proto__"), { found: false });
});

test("walker: constructor/prototype blocked", () => {
  assert.deepEqual(walkPath({ a: 1 }, "$.constructor"), { found: false });
  assert.deepEqual(walkPath([], "$.constructor.prototype.x"), { found: false });
  assert.deepEqual(walkPath({ a: { prototype: 1 } }, "$.a.prototype"), { found: false });
});

test("walker: malformed paths rejected", () => {
  for (const p of ["", "$.", "$.a..b", "$.a b", "$[", "$.a[", "$.a[-1]", "a.b", "$.a['b']", "$.a.*"]) {
    assert.deepEqual(walkPath({ a: 1 }, p), { found: false }, p);
  }
});

test("walker: bare $ returns root, scalar roots fail descent", () => {
  assert.deepEqual(walkPath({ a: 1 }, "$"), { found: true, value: { a: 1 } });
  assert.deepEqual(walkPath(42, "$.a"), { found: false });
  assert.deepEqual(walkPath(null, "$.a"), { found: false });
});

test("walker: values pass through by type", () => {
  assert.deepEqual(walkPath({ n: 0 }, "$.n"), { found: true, value: 0 });
  assert.deepEqual(walkPath({ b: false }, "$.b"), { found: true, value: false });
  assert.deepEqual(walkPath({ z: null }, "$.z"), { found: true, value: null });
});

test("substituteVars: basic + repeated", () => {
  assert.equal(substituteVars("https://h/{{t}}/x?y={{t}}", { t: "abc" }), "https://h/abc/x?y=abc");
});

test("substitution: unknown variable throws (never empty-strings)", () => {
  assert.throws(() => substituteVars("{{missing}}", {}), (e) => e instanceof ChainError && e.code === "undefined_variable");
});

test("validateUrlTemplate: path/query vars ok, host var rejected", () => {
  assert.deepEqual(validateUrlTemplate("https://h.com/p/{{t}}?x=1"), { scheme: "https:", host: "h.com" });
  assert.throws(() => validateUrlTemplate("https://{{h}}/x"), /never scheme or host/);
  assert.throws(() => validateUrlTemplate("{{https}}://h/x"), /could not be parsed/);
  assert.throws(() => validateUrlTemplate("ftp://h/x"), /Only http/);
  assert.throws(() => validateUrlTemplate("https://u:p@h/"), /credentials/);
});

test("isValidExtractPath whitelist", () => {
  assert.equal(isValidExtractPath("$"), true);
  assert.equal(isValidExtractPath("$.data.token"), true);
  assert.equal(isValidExtractPath("$.items[0].id"), true);
  assert.equal(isValidExtractPath("$.a..b"), false);
  assert.equal(isValidExtractPath("$.__proto__"), false);
  assert.equal(isValidExtractPath("$.constructor"), false);
});

test("referencedVars collects unique names", () => {
  assert.deepEqual(referencedVars("{{a}}/{{b}}/{{a}}"), ["a", "b"]);
  assert.deepEqual(referencedVars("no vars"), []);
});

test("extractValue: body/header/status sources", () => {
  const ctx = { statusCode: 201, headers: { "X-Token": "abc", "content-type": "application/json" }, bodyText: '{"data":{"token":"abc"}}' };
  assert.equal(extractValue({ variable: "t", source: "body", path: "$.data.token" }, ctx), "abc");
  assert.equal(extractValue({ variable: "h", source: "header", path: "x-token" }, ctx), "abc");
  assert.equal(extractValue({ variable: "s", source: "status", path: null }, ctx), "201");
});

test("extractValue: failures are ChainErrors without values", () => {
  const ctx = { statusCode: 200, headers: {}, bodyText: "not json" };
  assert.throws(() => extractValue({ variable: "t", source: "body", path: "$.a" }, ctx), /not valid JSON/);
  assert.throws(() => extractValue({ variable: "t", source: "header", path: "X-Missing" }, ctx), /not present/);
  assert.throws(() => extractValue({ variable: "t", source: "status", path: "$.x" }, ctx), /takes no path/);
  assert.throws(() => extractValue({ variable: "9bad", source: "status", path: null }, ctx), /must match/);
  assert.throws(() => extractValue({ variable: "t", source: "body", path: "$.a" }, { ...ctx, bodyText: '{"a":"' + "x".repeat(9000) + '"}' }), /8KB/);
});

test("extractValue: objects stringified", () => {
  const ctx = { statusCode: 200, headers: {}, bodyText: '{"o":{"k":1}}' };
  assert.equal(extractValue({ variable: "o", source: "body", path: "$.o" }, ctx), '{"k":1}');
});
