const TOKEN_KEY = "pulsecheck_token";
const EMAIL_KEY = "pulsecheck_email";

/** Read JWT from localStorage. Returns null on the server or when logged out. */
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getEmail(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(EMAIL_KEY);
}

export function setAuth(token: string, email: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EMAIL_KEY, email);
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMAIL_KEY);
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}

/** Use when redirecting after a 401 — shows a message on the login page. */
export const LOGIN_EXPIRED_PATH = "/login?expired=1";
