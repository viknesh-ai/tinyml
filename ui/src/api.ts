export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Options = { method?: string; json?: unknown; body?: BodyInit };

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const init: RequestInit = { method: opts.method };
  if (opts.json !== undefined) {
    init.body = JSON.stringify(opts.json);
    init.headers = { "Content-Type": "application/json" };
    init.method = opts.method ?? "POST";
  } else if (opts.body !== undefined) {
    init.body = opts.body;
    init.method = opts.method ?? "POST";
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError("Cannot reach the tinyml server. Is `tinyml serve` still running?", 0);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = (body as { detail?: unknown } | null)?.detail;
    throw new ApiError(typeof detail === "string" ? detail : res.statusText || "Request failed", res.status);
  }
  return body as T;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
