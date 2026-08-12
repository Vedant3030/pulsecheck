/** Normalize user input — strip accidental /status/ prefix or slashes. */
export function normalizePublicSlugInput(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^\/status\/?/, "")
    .replace(/^\/+|\/+$/g, "");
}
