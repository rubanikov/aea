/**
 * Shared fetch helper for talking to the backend API. Every call goes
 * through here so `credentials: "include"` (required to send/receive the
 * httpOnly auth cookie set by `POST /auth/login`) is set once, not repeated
 * ad hoc at every call site.
 */

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * A same-origin-only marker header the backend requires on every
 * unsafe-method request as CSRF mitigation for its cookie-delivered auth
 * token (a cross-site form submission can't attach a custom header, but it
 * *can* ride along with an ambient cookie). Not something any caller should
 * need to think about, hence set here rather than per call site.
 */
const CSRF_MITIGATION_HEADER = { "X-Requested-With": "XMLHttpRequest" };

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  /** JSON-serializable request body. Sent as `application/json`. */
  body?: unknown;
}

/**
 * Thrown by `apiJson` for any non-2xx response. `body` is the parsed JSON
 * error payload when the response had one (e.g.
 * `{"email": "already registered"}`), otherwise `null`.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Parses a response body as JSON, tolerating an empty or non-JSON body
 * (returns `null` in that case) rather than throwing.
 */
export async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Low-level request helper. Always sends cookies and returns the raw
 * `Response`, for callers that need to branch on status themselves (e.g.
 * `GET /auth/me` treating 401 as "logged out" rather than an error).
 */
export async function apiFetch(
  path: string,
  options: ApiRequestOptions = {}
): Promise<Response> {
  const { body, headers, method, ...rest } = options;
  const httpMethod = (method ?? "GET").toUpperCase();
  return fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    method,
    credentials: "include",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(SAFE_METHODS.has(httpMethod) ? {} : CSRF_MITIGATION_HEADER),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/**
 * `apiFetch` plus JSON parsing and error handling: resolves with the parsed
 * body on any 2xx response, throws `ApiError` otherwise.
 */
export async function apiJson<T>(
  path: string,
  options?: ApiRequestOptions
): Promise<T> {
  const response = await apiFetch(path, options);
  const body = await readJsonBody(response);
  if (!response.ok) {
    throw new ApiError(response.status, body);
  }
  return body as T;
}

/**
 * Calls `POST /auth/refresh` (reads the httpOnly refresh cookie, rotates
 * both cookies on success). The access-token cookie is short-lived (15 min)
 * by design, so any authenticated session longer than that depends on this
 * succeeding -- callers should attempt it once before treating a 401 as
 * "the user needs to log in again".
 */
export async function refreshSession(): Promise<boolean> {
  try {
    const response = await apiFetch("/auth/refresh", { method: "POST" });
    return response.ok;
  } catch {
    return false;
  }
}
