const DEFAULT_TIMEOUT_MS = 30_000;
const USER_AGENT = 'warframe-companion/0.1 (local tool; open data only)';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

async function request(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT },
    });
    if (!response.ok) {
      throw new HttpError(`HTTP ${response.status} при загрузке ${url}`, url, response.status);
    }
    return response;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const reason = controller.signal.aborted ? `таймаут ${timeoutMs} мс` : String((error as Error).message ?? error);
    throw new HttpError(`Не удалось загрузить ${url}: ${reason}`, url);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const response = await request(url, timeoutMs);
  return response.text();
}

export async function fetchBytes(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Uint8Array> {
  const response = await request(url, timeoutMs);
  return new Uint8Array(await response.arrayBuffer());
}

export async function fetchJson<T>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  return parseJsonLenient<T>(await fetchText(url, timeoutMs), url);
}

/** Public Export files sometimes contain raw control characters inside strings. */
export function parseJsonLenient<T>(text: string, origin = 'json'): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    try {
      return JSON.parse(text.replace(/[\u0000-\u001f]+/g, ' ')) as T;
    } catch (error) {
      throw new Error(`Некорректный JSON из ${origin}: ${(error as Error).message}`);
    }
  }
}
