export const DEFAULT_REQUEST_TIMEOUT_MS = 8000;

export function apiPath(path: string) {
  return path.startsWith("/api/") ? path : `/api/${path.replace(/^\//, "")}`;
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
  const upstreamSignal = init?.signal;
  const abortFromUpstream = () => controller.abort();

  if (upstreamSignal?.aborted) controller.abort();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });

  try {
    const response = await fetch(apiPath(path), { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const detail =
        payload && typeof payload === "object" && "detail" in payload && typeof payload.detail === "string"
          ? payload.detail
          : `Request failed with status ${response.status}.`;
      throw new Error(detail);
    }

    return payload as T;
  } catch (error) {
    if (controller.signal.aborted && !upstreamSignal?.aborted) {
      throw new Error("The API did not respond within 8 seconds.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}
