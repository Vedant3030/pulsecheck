/**
 * Pure assertion helpers — no I/O, never throws.
 * Mirrors backend strict validation so worker never crashes on malformed assertions.
 */

const BODY_CAP = 512 * 1024;

export function getByDotPath(obj, field) {
  if (!field || typeof field !== "string") return undefined;
  const parts = field.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function toComparable(value) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isNumericString(v) {
  return typeof v === "string" && v.trim() !== "" && !isNaN(Number(v));
}

function compareWithOperator(actual, expected, operator) {
  // Numeric operators require numeric comparison
  if (operator === "LESS_THAN" || operator === "GREATER_THAN") {
    const aNum = Number(actual);
    const eNum = Number(expected);
    if (isNaN(aNum) || isNaN(eNum)) {
      return { pass: false, reason: `non-numeric comparison: actual '${actual}' vs expected '${expected}'` };
    }
    const pass = operator === "LESS_THAN" ? aNum < eNum : aNum > eNum;
    return { pass, reason: pass ? "" : `${aNum} not ${operator === "LESS_THAN" ? "<" : ">"} ${eNum}` };
  }
  if (operator === "EQUALS") {
    // Loose string equality (covers numeric strings vs numbers, booleans)
    const pass = toComparable(actual) === toComparable(expected);
    return { pass, reason: pass ? "" : `expected '${expected}' but got '${toComparable(actual)}'` };
  }
  if (operator === "CONTAINS") {
    const pass = toComparable(actual).includes(toComparable(expected));
    return { pass, reason: pass ? "" : `expected to contain '${expected}'` };
  }
  return { pass: false, reason: `unknown operator ${operator}` };
}

export function evaluateSingle(assertion, context) {
  const { type, field, operator, expectedValue } = assertion;
  const { statusCode, responseTimeMs, bodyText, wasTruncated } = context;
  const truncationNote = wasTruncated ? " (response body truncated at 512kb, field may not have been found)" : "";

  try {
    if (type === "STATUS_CODE") {
      const { pass, reason } = compareWithOperator(statusCode, expectedValue, operator);
      return {
        type, field, operator, expectedValue,
        actual: statusCode != null ? String(statusCode) : "<no response>",
        pass,
        message: pass ? `STATUS_CODE ${operator} ${expectedValue} — got ${statusCode}` : `STATUS_CODE expected ${expectedValue} but got ${statusCode}${reason ? ` — ${reason}` : ""}`,
      };
    }
    if (type === "RESPONSE_TIME") {
      const { pass, reason } = compareWithOperator(responseTimeMs, expectedValue, operator);
      return {
        type, field, operator, expectedValue,
        actual: responseTimeMs != null ? String(responseTimeMs) : "<no response>",
        pass,
        message: pass ? `RESPONSE_TIME ${operator} ${expectedValue} — got ${responseTimeMs}ms` : `RESPONSE_TIME expected ${operator} ${expectedValue}ms but got ${responseTimeMs}ms${reason ? ` — ${reason}` : ""}`,
      };
    }
    if (type === "BODY_CONTAINS") {
      const actual = bodyText ?? "";
      const { pass, reason } = compareWithOperator(actual, expectedValue, operator);
      return {
        type, field, operator, expectedValue,
        actual: actual.slice(0, 200),
        pass,
        message: pass ? `BODY_CONTAINS "${expectedValue}" found` : `BODY_CONTAINS expected "${expectedValue}" not found${reason ? ` — ${reason}` : ""}${truncationNote}`,
      };
    }
    if (type === "JSON_FIELD_EQUALS") {
      let parsed;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        return {
          type, field, operator, expectedValue,
          actual: "<invalid JSON>",
          pass: false,
          message: `response body is not valid JSON — JSON field '${field}' cannot be evaluated${truncationNote}`,
        };
      }
      const actualVal = getByDotPath(parsed, field);
      if (actualVal === undefined) {
        return {
          type, field, operator, expectedValue,
          actual: "<missing>",
          pass: false,
          message: `JSON field '${field}' not found${truncationNote} (body keys: ${Object.keys(parsed || {}).slice(0,5).join(", ")})`,
        };
      }
      const { pass, reason } = compareWithOperator(actualVal, expectedValue, operator);
      return {
        type, field, operator, expectedValue,
        actual: toComparable(actualVal),
        pass,
        message: pass ? `JSON field '${field}' equals '${expectedValue}'` : `JSON field '${field}' expected '${expectedValue}' but got '${toComparable(actualVal)}'${reason ? ` — ${reason}` : ""}${truncationNote}`,
      };
    }
    return { type, field, operator, expectedValue, actual: "<unknown type>", pass: false, message: `Unknown assertion type ${type}` };
  } catch (err) {
    return {
      type, field, operator, expectedValue,
      actual: "<error>",
      pass: false,
      message: `Assertion evaluation error: ${err.message}${truncationNote}`,
    };
  }
}

export function evaluateAssertions(assertions, context) {
  if (!assertions || assertions.length === 0) return [];
  return assertions.map((a) => evaluateSingle(a, context));
}
