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
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfterSeconds = parseRetryAfterSeconds(retryAfterHeader);
        const reasonCode = extractReasonCode(bodyText);

        if (attempt < retries && retryStatusCodes.includes(response.status)) {
          await sleep(300 * (attempt + 1));
          attempt += 1;
          continue;
        }

        throw new ExternalApiError(
          `${provider} request failed with status ${response.status}: ${truncate(bodyText)}`,
          provider,
          response.status,
          truncate(bodyText),
          retryAfterSeconds,
          reasonCode,
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

function parseRetryAfterSeconds(value: string | null) {
  if (!value) {
    return undefined;
  }

  const parsedNumber = Number(value);
  if (Number.isFinite(parsedNumber) && parsedNumber >= 0) {
    return parsedNumber;
  }

  const parsedDate = Date.parse(value);
  if (Number.isFinite(parsedDate)) {
    return Math.max(0, Math.ceil((parsedDate - Date.now()) / 1000));
  }

  return undefined;
}

function extractReasonCode(bodyText: string) {
  if (!bodyText) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(bodyText) as {
      error?:
        | string
        | {
        status?: string;
        errors?: Array<{ reason?: string }>;
        };
      error_description?: string;
    };

    if (typeof parsed.error === "string") {
      return parsed.error;
    }

    return parsed.error?.errors?.[0]?.reason ?? parsed.error?.status ?? parsed.error_description;
  } catch {
    return undefined;
  }
}

function truncate(value: string, max = 400) {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max)}...`;
}
