/**
 * Browser-safe helpers for the password reset flow.
 * Kept separate from the route files so the link rules can be tested directly.
 */

export const RESET_PATH = "/reset-password";

/** Where a reset email should land the user, on the same origin as the app. */
export function resetRedirectTo(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${RESET_PATH}`;
}

function params(value: string): URLSearchParams {
  const raw = value.startsWith("#") || value.startsWith("?") ? value.slice(1) : value;
  return new URLSearchParams(raw);
}

/** True when the fragment carries a password-recovery session marker. */
export function isRecoveryLink(hash: string): boolean {
  if (!hash) return false;
  try {
    return params(hash).get("type") === "recovery";
  } catch {
    return false;
  }
}

/**
 * True when the browser arrived here from an auth link (session in the fragment
 * or an exchanged code in the query). A bare visit to the page is not a link.
 */
export function isAuthLink(hash: string, search: string): boolean {
  try {
    if (isRecoveryLink(hash)) return true;
    const h = params(hash);
    const q = params(search);
    return h.has("access_token") || h.has("code") || q.has("code");
  } catch {
    return false;
  }
}
