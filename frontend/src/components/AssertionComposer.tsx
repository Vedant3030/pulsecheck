"use client";

import { useState } from "react";
import type { AssertionInput } from "@/lib/api";
import type { AssertionOperator, AssertionType } from "@/types/monitor";

type Subject = "RESPONSE_TIME" | "STATUS_CODE" | "BODY" | "JSON";

const SUBJECTS: { value: Subject; label: string }[] = [
  { value: "STATUS_CODE", label: "Status code" },
  { value: "RESPONSE_TIME", label: "Response time" },
  { value: "BODY", label: "Response body" },
  { value: "JSON", label: "JSON field" },
];

const PREDICATES: Record<Subject, { value: AssertionOperator; label: string }[]> = {
  STATUS_CODE: [{ value: "EQUALS", label: "is" }],
  RESPONSE_TIME: [
    { value: "GREATER_THAN", label: "is slower than" },
    { value: "LESS_THAN", label: "is faster than" },
    { value: "EQUALS", label: "is exactly" },
  ],
  BODY: [
    { value: "CONTAINS", label: "contains" },
    { value: "EQUALS", label: "is exactly" },
  ],
  JSON: [
    { value: "EQUALS", label: "is" },
    { value: "CONTAINS", label: "contains" },
    { value: "LESS_THAN", label: "is less than" },
    { value: "GREATER_THAN", label: "is greater than" },
  ],
};

function subjectToType(subject: Subject): AssertionType {
  if (subject === "BODY") return "BODY_CONTAINS";
  if (subject === "JSON") return "JSON_FIELD_EQUALS";
  return subject;
}

/** Mirrors backend strict validation so bad rules are caught before submit. */
export function validateAssertionDraft(
  type: AssertionType,
  field: string,
  operator: AssertionOperator,
  expectedValue: string,
): string | null {
  if (!expectedValue.trim()) return "Expected value is required.";
  if (type === "JSON_FIELD_EQUALS" && !field.trim()) {
    return "Field path is required for JSON field assertions (e.g. data.status).";
  }
  const numericExpected =
    type === "STATUS_CODE" ||
    type === "RESPONSE_TIME" ||
    (type === "JSON_FIELD_EQUALS" &&
      (operator === "LESS_THAN" || operator === "GREATER_THAN"));
  if (numericExpected && Number.isNaN(Number(expectedValue))) {
    return "Expected value must be numeric for this rule.";
  }
  return null;
}

/** Plain-English rendering of a stored or draft rule (no raw enum names). */
export function assertionSentence(
  type: AssertionType,
  field: string | null,
  operator: AssertionOperator,
  expectedValue: string,
): string {
  const value = expectedValue;
  switch (type) {
    case "STATUS_CODE":
      return `Status code is ${value}`;
    case "RESPONSE_TIME": {
      const relation =
        operator === "GREATER_THAN" ? "is slower than" : operator === "LESS_THAN" ? "is faster than" : "is exactly";
      return `Response time ${relation} ${value} ms`;
    }
    case "BODY_CONTAINS":
      return `Response body ${operator === "CONTAINS" ? "contains" : "is exactly"} ${value}`;
    case "JSON_FIELD_EQUALS": {
      const relation =
        operator === "CONTAINS"
          ? "contains"
          : operator === "LESS_THAN"
            ? "is less than"
            : operator === "GREATER_THAN"
              ? "is greater than"
              : "is";
      return `JSON ${field ?? ""} ${relation} ${value}`;
    }
  }
}

export function AssertionComposer({
  onAdd,
  idPrefix,
  disabled,
}: {
  onAdd: (assertion: AssertionInput) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const [subject, setSubject] = useState<Subject>("STATUS_CODE");
  const [predicate, setPredicate] = useState<AssertionOperator>("EQUALS");
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubjectChange(next: Subject) {
    setSubject(next);
    setPredicate(PREDICATES[next][0].value);
    setError(null);
  }

  function handleAdd() {
    const type = subjectToType(subject);
    const validationError = validateAssertionDraft(
      type,
      subject === "JSON" ? field : "",
      predicate,
      value,
    );
    if (validationError) {
      setError(validationError);
      return;
    }
    onAdd({
      type,
      field: subject === "JSON" ? field.trim() : null,
      operator: predicate,
      expectedValue: value.trim(),
    });
    setField("");
    setValue("");
    setError(null);
  }

  return (
    <div className="mt-2">
      <p className="text-xs text-[var(--text-muted)]">
        Alert me when{" "}
        <label className="sr-only" htmlFor={`assert-subject-${idPrefix}`}>What to check</label>
        <select
          id={`assert-subject-${idPrefix}`}
          value={subject}
          onChange={(e) => handleSubjectChange(e.target.value as Subject)}
          className="management-control mx-1 inline-block w-auto text-xs"
        >
          {SUBJECTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>{" "}
        <label className="sr-only" htmlFor={`assert-predicate-${idPrefix}`}>Condition</label>
        <select
          id={`assert-predicate-${idPrefix}`}
          value={predicate}
          onChange={(e) => setPredicate(e.target.value as AssertionOperator)}
          className="management-control mx-1 inline-block w-auto text-xs"
        >
          {PREDICATES[subject].map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>{" "}
        {subject === "JSON" && (
          <>
            <label className="sr-only" htmlFor={`assert-field-${idPrefix}`}>JSON field path</label>
            <input
              id={`assert-field-${idPrefix}`}
              value={field}
              onChange={(e) => setField(e.target.value)}
              className="management-control mx-1 inline-block w-36 font-mono text-xs"
              placeholder="data.status"
              spellCheck={false}
            />{" "}
          </>
        )}
        <label className="sr-only" htmlFor={`assert-value-${idPrefix}`}>Expected value</label>
        <input
          id={`assert-value-${idPrefix}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="management-control mx-1 inline-block w-32 font-mono text-xs"
          placeholder={subject === "STATUS_CODE" ? "200" : subject === "RESPONSE_TIME" ? "2000" : "expected value"}
          spellCheck={false}
        />
        {subject === "RESPONSE_TIME" && <span className="text-xs text-[var(--text-muted)]"> ms</span>}{" "}
        <button
          type="button"
          onClick={handleAdd}
          disabled={disabled}
          className="text-xs font-medium text-phosphor hover:underline disabled:opacity-50"
        >
          + Add rule
        </button>
      </p>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
