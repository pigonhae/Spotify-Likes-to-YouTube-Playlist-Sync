import { setTimeout as sleep } from "node:timers/promises";

import { ExternalApiError } from "./errors.js";

export interface RequestJsonOptions extends RequestInit {
  provider: string;
  retries?: number;
  retryStatusCodes?: number[];
  timeoutMs?: number;
}

export async function requestJson<T>(url: string, options: RequestJsonOptions): Promise<T> {
  const {
    provider,
    retries = 2,
    retryStatusCodes = [408, 409, 425, 429, 500, 502, 503, 504],
    timeoutMs = 20_000,
    headers,
    ...rest
  } = options;

  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...rest,
        headers: {
          accept: "application/json",
          ...headers,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const bodyText = await response.text();

        if (attempt < retries && retryStatusCodes.includes(response.status)) {
          await sleep(300 * (attempt + 1));
          attempt += 1;
          continue;
        }

        throw new ExternalApiError(
          `${provider} request failed with status ${response.status}: ${truncate(bodyText)}`,
          provider,
          response.status,
        );
      }

      const text = await response.text();
      return text ? (JSON.parse(text) as T) : ({} as T);
    } catch (error) {
      lastError = error;

      if (attempt >= retries) {
        break;
      }

      await sleep(300 * (attempt + 1));
      attempt += 1;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError instanceof ExternalApiError) {
    throw lastError;
  }

  throw new ExternalApiError(`${provider} request failed: ${String(lastError)}`, provider);
}

function truncate(value: string, max = 400) {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max)}...`;
}
