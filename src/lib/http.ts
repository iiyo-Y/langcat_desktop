/**
 * HTTP 工具 —— 镜像 langcat_chome/src/lib/http.ts
 *
 * 在 Electron 渲染层用原生 fetch + AbortController,跟浏览器环境一致。
 * 失败就抛(规则 4),不写 fallback。
 */

import { API_CONFIG } from '@config/api';

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class HttpTimeoutError extends Error {
  constructor(public readonly url: string, public readonly timeoutMs: number) {
    super(`请求超时 ${timeoutMs}ms: ${url}`);
    this.name = 'HttpTimeoutError';
  }
}

export class HttpNetworkError extends Error {
  constructor(public readonly url: string, public override readonly cause: unknown) {
    super(`网络错误: ${url}`);
    this.name = 'HttpNetworkError';
  }
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const internalController = new AbortController();
  const timeoutId = setTimeout(
    () => internalController.abort(),
    API_CONFIG.timeoutMs,
  );

  // 把外部 signal 与内部超时 signal 合并:任一触发都中止请求
  const onExternalAbort = (): void => internalController.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      throw new DOMException('已被外部信号中止', 'AbortError');
    }
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      signal: internalController.signal,
      headers: { Accept: 'application/json' },
    });
  } catch (cause) {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onExternalAbort);

    if (cause instanceof DOMException && cause.name === 'AbortError') {
      // 区分是外部主动取消还是超时:外部取消时直接重抛 AbortError,让上层 swallow
      if (signal?.aborted) throw cause;
      throw new HttpTimeoutError(url, API_CONFIG.timeoutMs);
    }
    throw new HttpNetworkError(url, cause);
  }

  clearTimeout(timeoutId);
  signal?.removeEventListener('abort', onExternalAbort);

  if (!response.ok) {
    throw new HttpError(
      `HTTP ${response.status} ${response.statusText}`,
      response.status,
      url,
    );
  }

  return (await response.json()) as T;
}
