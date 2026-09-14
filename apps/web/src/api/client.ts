const TOKEN_KEY = "chronarch_token";

/** "Remember me" (checked): token persists in localStorage across restarts.
 * Unchecked: sessionStorage only — the session dies with the tab.
 * getToken checks both so existing logins keep working. */
function stores(): Storage[] {
  const list: Storage[] = [];
  try {
    list.push(localStorage);
  } catch {
    /* private mode */
  }
  try {
    if (sessionStorage) list.push(sessionStorage);
  } catch {
    /* private mode */
  }
  return list;
}

export function getToken(): string | null {
  for (const store of stores()) {
    try {
      const token = store.getItem(TOKEN_KEY);
      if (token) return token;
    } catch {
      /* unreadable store */
    }
  }
  return null;
}

export function setToken(token: string | null, persistent: boolean = true) {
  for (const store of stores()) {
    try {
      const isLocal = (() => {
        try {
          return store === localStorage;
        } catch {
          return false;
        }
      })();
      if (token === null) {
        store.removeItem(TOKEN_KEY);
      } else if (persistent ? isLocal : !isLocal) {
        store.setItem(TOKEN_KEY, token);
      } else {
        store.removeItem(TOKEN_KEY);
      }
    } catch {
      /* unwritable store */
    }
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  try {
    headers.set("X-Timezone", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  } catch {
    headers.set("X-Timezone", "UTC");
  }

  const res = await fetch(`/api/v1${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Extract the server's `detail` string from an apiFetch error, if present. */
function serverDetail(raw: string): string | null {
  const idx = raw.indexOf("{");
  if (idx === -1) return null;
  try {
    const parsed = JSON.parse(raw.slice(idx));
    return typeof parsed?.detail === "string" ? parsed.detail : null;
  } catch {
    return null;
  }
}

/** True when a detail string looks like an internal dump rather than a
 * message written for users (provider payloads, tracebacks, key echoes). */
function looksLikeDump(detail: string): boolean {
  return (
    detail.length > 220 ||
    detail.includes("Traceback") ||
    detail.includes("litellm.") ||
    detail.includes("File \"") ||
    /"[a-z_]+":\s?\{/.test(detail)
  );
}

/** Translate a thrown fetch/API error into something meaningful for folks.
 * Display sites should call this instead of String(err) — raw payloads
 * (status lines, JSON bodies, provider dumps) never reach the UI.
 */
export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const statusMatch = /^(\d{3})\b/.exec(raw);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
  const detail = serverDetail(raw);

  if (!status) {
    if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
      return "Couldn't reach the server. Check your connection and try again.";
    }
    return raw || "Something went wrong. Try again.";
  }

  const clean = detail && !looksLikeDump(detail) ? detail : null;
  switch (status) {
    case 400:
      return clean ?? "That request wasn't valid. Check the values and try again.";
    case 401:
      return "Your session expired. Sign in again.";
    case 403:
      return clean ?? "You don't have permission to do that.";
    case 404:
      return "That item no longer exists. Refresh to update.";
    case 409:
      return clean ?? "That already exists.";
    case 422:
      return clean ?? "Some values need attention. Check the form and try again.";
    case 429:
      return clean ?? "The AI service is rate-limiting us. Wait a minute and try again.";
    case 502:
    case 503:
      return (
        clean ?? "The service is having trouble right now. Try again in a bit."
      );
    default:
      if (status >= 500) return "Something went wrong on our side. Try again.";
      return clean ?? "Something went wrong. Try again.";
  }
}
