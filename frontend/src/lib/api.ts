import type { CheckResult, Monitor } from "@/types/monitor";
import type { PublicStatusPage, UserProfile } from "@/types/status";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface ApiError {
  error?: string;
}

export interface LoginResponse {
  token: string;
  email: string;
}

export interface SignupResponse {
  id: string;
  email: string;
}

export interface MonitorInput {
  name: string;
  url: string;
  intervalMins: number;
  isActive?: boolean;
}

async function parseError(res: Response): Promise<string> {
  const text = await res.text();

  try {
    const data = JSON.parse(text) as ApiError;
    return data.error ?? `Request failed (${res.status})`;
  } catch {
    if (text.trimStart().startsWith("<!DOCTYPE") || text.trimStart().startsWith("<html")) {
      if (res.status === 404) {
        return "API route not found — restart the backend server (npm run dev in backend/)";
      }
      return `Server returned HTML instead of JSON (${res.status}). Is the backend running on ${API_URL}?`;
    }
    return text || `Request failed (${res.status})`;
  }
}

async function ensureAuthed(res: Response): Promise<void> {
  if (res.status === 401) {
    const { clearAuth } = await import("@/lib/auth");
    clearAuth();
    throw new Error("Session expired");
  }
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const res = await fetch(`${API_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data: LoginResponse & ApiError = await res.json();

  if (!res.ok) {
    throw new Error(data.error ?? "Login failed");
  }

  return { token: data.token, email: data.email };
}

export async function signup(
  email: string,
  password: string,
): Promise<SignupResponse> {
  const res = await fetch(`${API_URL}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = (await res.json()) as SignupResponse & ApiError;

  if (!res.ok) {
    throw new Error(data.error ?? "Signup failed");
  }

  return { id: data.id, email: data.email };
}

/** Authenticated fetch — attaches Bearer token from localStorage. */
export async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const { getToken } = await import("@/lib/auth");
  const token = getToken();

  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}

export async function fetchMonitors(): Promise<Monitor[]> {
  const res = await apiFetch("/monitors");
  await ensureAuthed(res);

  if (!res.ok) {
    throw new Error(await parseError(res));
  }

  return (await res.json()) as Monitor[];
}

export async function fetchMonitorChecks(
  monitorId: string,
  limit = 60,
): Promise<CheckResult[]> {
  const res = await apiFetch(`/monitors/${monitorId}/checks?limit=${limit}`);
  await ensureAuthed(res);

  if (!res.ok) {
    throw new Error(await parseError(res));
  }

  return (await res.json()) as CheckResult[];
}

export async function createMonitor(input: MonitorInput): Promise<void> {
  const res = await apiFetch("/monitors", {
    method: "POST",
    body: JSON.stringify(input),
  });
  await ensureAuthed(res);

  if (!res.ok) {
    throw new Error(await parseError(res));
  }
}

export async function updateMonitor(
  id: string,
  input: MonitorInput,
): Promise<void> {
  const res = await apiFetch(`/monitors/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  await ensureAuthed(res);

  if (!res.ok) {
    throw new Error(await parseError(res));
  }
}

export async function deleteMonitor(id: string): Promise<void> {
  const res = await apiFetch(`/monitors/${id}`, { method: "DELETE" });
  await ensureAuthed(res);

  if (!res.ok) {
    throw new Error(await parseError(res));
  }
}

export async function fetchMe(): Promise<UserProfile> {
  const res = await apiFetch("/me");
  await ensureAuthed(res);

  if (!res.ok) {
    throw new Error(await parseError(res));
  }

  return (await res.json()) as UserProfile;
}

export async function updatePublicSlug(
  publicSlug: string | null,
): Promise<UserProfile> {
  const res = await apiFetch("/me/public-slug", {
    method: "PUT",
    body: JSON.stringify({ publicSlug }),
  });
  await ensureAuthed(res);

  if (!res.ok) {
    throw new Error(await parseError(res));
  }

  return (await res.json()) as UserProfile;
}

export async function fetchPublicStatus(slug: string): Promise<PublicStatusPage> {
  const res = await fetch(`${API_URL}/status/${encodeURIComponent(slug)}`);

  if (res.status === 404) {
    throw new Error("Status page not found");
  }

  if (!res.ok) {
    throw new Error(await parseError(res));
  }

  return (await res.json()) as PublicStatusPage;
}

export async function fetchPublicMonitorChecks(
  slug: string,
  monitorId: string,
  limit = 60,
): Promise<CheckResult[]> {
  const res = await fetch(
    `${API_URL}/status/${encodeURIComponent(slug)}/monitors/${monitorId}/checks?limit=${limit}`,
  );

  if (!res.ok) {
    throw new Error(await parseError(res));
  }

  return (await res.json()) as CheckResult[];
}
