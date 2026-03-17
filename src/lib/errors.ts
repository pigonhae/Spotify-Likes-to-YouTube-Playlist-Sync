export class AppError extends Error {
  public readonly statusCode: number;
  public readonly expose: boolean;

  constructor(message: string, statusCode = 500, expose = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.expose = expose;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class ExternalApiError extends AppError {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly status?: number,
    public readonly bodySnippet?: string,
    public readonly retryAfterSeconds?: number,
    public readonly reasonCode?: string,
  ) {
    super(message, 502);
  }
}

export class QuotaExceededError extends AppError {
  constructor(
    message = "YouTube quota exceeded",
    public readonly retryAfterSeconds?: number,
    public readonly reasonCode?: string,
  ) {
    super(message, 429);
  }
}

export class RetryableSyncPauseError extends AppError {
  constructor(
    message: string,
    public readonly provider: "spotify" | "youtube",
    public readonly nextRetryAt: number,
    public readonly reasonCode?: string,
  ) {
    super(message, 429);
  }
}

export class ReauthRequiredError extends AppError {
  constructor(
    public readonly provider: "spotify" | "youtube",
    message = `${provider} account needs to be reconnected`,
    public readonly reasonCode?: string,
  ) {
    super(message, 401);
  }
}

export class NoSearchResultsError extends AppError {
  constructor(message = "No search results found") {
    super(message, 404);
  }
}

export class LowConfidenceMatchError extends AppError {
  constructor(message = "No candidate passed the confidence threshold") {
    super(message, 409);
  }
}
