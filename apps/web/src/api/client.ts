const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ??
  (import.meta.env.DEV ? `http://${window.location.hostname}:3100` : "")
).replace(/\/$/, "");

type CacheEntry = { expiresAt: number; value: unknown };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryAfter?: number;
  readonly details?: unknown;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      retryAfter?: number;
      details?: unknown;
    },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.retryAfter = options.retryAfter;
    this.details = options.details;
  }
}

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function isMutation(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("Retry-After");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1_000, 30_000);
    const date = new Date(header).getTime();
    if (!Number.isNaN(date))
      return Math.min(Math.max(0, date - Date.now()), 30_000);
  }
  const base = Math.min(500 * 2 ** attempt, 4_000);
  return Math.round(base * (0.7 + Math.random() * 0.6));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(new DOMException("Operação cancelada", "AbortError"));
      },
      { once: true },
    );
  });
}

async function responseError(response: Response): Promise<ApiError> {
  let details: unknown;
  try {
    details = await response.clone().json();
  } catch {
    details = await response.text().catch(() => undefined);
  }
  const object =
    details && typeof details === "object"
      ? (details as Record<string, unknown>)
      : {};
  const nested =
    object.error && typeof object.error === "object"
      ? (object.error as Record<string, unknown>)
      : {};
  const message =
    (typeof object.message === "string" && object.message) ||
    (typeof nested.message === "string" && nested.message) ||
    (typeof object.error_description === "string" &&
      object.error_description) ||
    (typeof object.error === "string" && object.error) ||
    `A API respondeu com status ${response.status}.`;
  const code =
    typeof object.code === "string"
      ? object.code
      : typeof nested.code === "string"
        ? nested.code
        : typeof object.error === "string"
          ? object.error
          : undefined;
  const retryHeader = response.headers.get("Retry-After");
  const retryAfter =
    retryHeader && Number.isFinite(Number(retryHeader))
      ? Number(retryHeader)
      : undefined;
  return new ApiError(message, {
    status: response.status,
    code,
    retryAfter,
    details,
  });
}

export type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  csrfToken?: string | null;
  retries?: number;
};

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  if (isMutation(method) && !options.csrfToken) {
    throw new ApiError("A sessão não forneceu um token CSRF válido.", {
      status: 403,
      code: "missing_csrf_token",
    });
  }

  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (isMutation(method)) headers.set("X-CSRF-Token", options.csrfToken!);

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (
      options.body instanceof FormData ||
      options.body instanceof URLSearchParams
    ) {
      body = options.body;
    } else {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }
  }

  const retries = options.retries ?? (method === "GET" ? 2 : 0);
  const { csrfToken: _csrfToken, retries: _retries, ...fetchOptions } = options;
  let lastError: ApiError | undefined;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(apiUrl(path), {
      ...fetchOptions,
      method,
      headers,
      body,
      credentials: "include",
    });

    if (response.ok) {
      if (response.status === 204) return undefined as T;
      const contentType = response.headers.get("Content-Type") ?? "";
      if (!contentType.includes("json")) return (await response.text()) as T;
      return (await response.json()) as T;
    }

    lastError = await responseError(response);
    const transient = [429, 500, 502, 503, 504].includes(response.status);
    if (!transient || attempt === retries) throw lastError;
    await sleep(retryDelay(response, attempt), options.signal ?? undefined);
  }

  throw (
    lastError ??
    new ApiError("Não foi possível concluir a requisição.", { status: 0 })
  );
}

export async function apiGet<T>(
  path: string,
  options: {
    signal?: AbortSignal;
    cacheTtl?: number;
    dedupe?: boolean;
    retries?: number;
  } = {},
): Promise<T> {
  const key = apiUrl(path);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;

  const canDedupe = (options.dedupe ?? true) && !options.signal;
  if (canDedupe && inFlight.has(key)) return inFlight.get(key) as Promise<T>;

  const promise = apiRequest<T>(path, {
    signal: options.signal,
    retries: options.retries,
  }).then((value) => {
    if (options.cacheTtl) {
      cache.set(key, { expiresAt: Date.now() + options.cacheTtl, value });
    }
    return value;
  });

  if (canDedupe) inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    if (canDedupe) inFlight.delete(key);
  }
}

export async function apiDownload(
  path: string,
  signal?: AbortSignal,
): Promise<{
  blob: Blob;
  filename?: string;
}> {
  const response = await fetch(apiUrl(path), {
    method: "GET",
    headers: {
      Accept:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    credentials: "include",
    signal,
  });
  if (!response.ok) throw await responseError(response);
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  const encoded = utf8Match?.[1] ?? plainMatch?.[1];
  let filename: string | undefined;
  if (encoded) {
    try {
      filename = decodeURIComponent(encoded);
    } catch {
      filename = encoded;
    }
  }
  return { blob: await response.blob(), filename };
}

export function clearApiCache(prefix = ""): void {
  for (const key of cache.keys()) {
    if (!prefix || key.includes(prefix)) cache.delete(key);
  }
}

export function friendlyApiError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError")
    return "Operação cancelada.";
  if (!(error instanceof ApiError)) {
    if (!navigator.onLine)
      return "Sem conexão. Verifique a internet e tente novamente.";
    return error instanceof Error
      ? error.message
      : "Ocorreu um erro inesperado.";
  }
  if (error.status === 401)
    return "Sua sessão expirou ou foi revogada. Reconecte a conta.";
  if (error.status === 403)
    return "A conta ou a aplicação não tem permissão para esta operação.";
  if (error.status === 404)
    return "O recurso solicitado não está mais disponível.";
  if (error.status === 409)
    return "A operação conflita com uma atualização em andamento.";
  if (error.status === 429) {
    return error.retryAfter
      ? `Limite temporário atingido. Tente novamente em ${error.retryAfter} s.`
      : "Limite temporário atingido. Aguarde antes de tentar novamente.";
  }
  if (error.status >= 500)
    return "O serviço está temporariamente indisponível. Tente mais tarde.";
  return error.message;
}
