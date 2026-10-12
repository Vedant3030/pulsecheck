import type { AssertionInput } from "@/lib/api";
import type { ChainStepForm } from "@/components/ChainStepsEditor";

export interface SingleTemplateBody {
  method: string;
  url: string;
  requestBody: string;
  headers: Record<string, string>;
  assertions: AssertionInput[];
}

export interface MonitorTemplate {
  id: string;
  name: string;
  description: string;
  monitorType: "single" | "chain";
  single?: SingleTemplateBody;
  steps?: Omit<ChainStepForm, "id" | "hasAuth">[];
}

/** One-click starting points that fill the monitor form. Edit after applying. */
export const MONITOR_TEMPLATES: MonitorTemplate[] = [
  {
    id: "json-api",
    name: "Check a JSON API",
    description: "GET a health endpoint and alert unless it returns 200.",
    monitorType: "single",
    single: {
      method: "GET",
      url: "https://api.example.com/health",
      requestBody: "",
      headers: {},
      assertions: [
        { type: "STATUS_CODE", field: null, operator: "EQUALS", expectedValue: "200" },
      ],
    },
  },
  {
    id: "login-chain",
    name: "Login, then call an API",
    description: "POST credentials, save the token, call an endpoint with it.",
    monitorType: "chain",
    steps: [
      {
        name: "Login",
        method: "POST",
        url: "https://api.example.com/login",
        requestBody: '{\n  "username": "monitor@example.com",\n  "password": "REPLACE-ME"\n}',
        headers: [],
        authType: "none",
        authValue: "",
        authHeaderName: "X-API-Key",
        extracts: [{ variable: "token", source: "body", path: "$.data.token" }],
        assertions: [
          { type: "STATUS_CODE", field: null, operator: "EQUALS", expectedValue: "200" },
        ],
      },
      {
        name: "Authed request",
        method: "GET",
        url: "https://api.example.com/me",
        requestBody: "",
        headers: [],
        authType: "bearer",
        authValue: "{{token}}",
        authHeaderName: "X-API-Key",
        extracts: [],
        assertions: [
          { type: "STATUS_CODE", field: null, operator: "EQUALS", expectedValue: "200" },
        ],
      },
    ],
  },
  {
    id: "keyword-watch",
    name: "Watch a page for a keyword",
    description: "Alert when a page stops containing expected text.",
    monitorType: "single",
    single: {
      method: "GET",
      url: "https://example.com",
      requestBody: "",
      headers: {},
      assertions: [
        { type: "BODY_CONTAINS", field: null, operator: "CONTAINS", expectedValue: "Example Domain" },
      ],
    },
  },
];
