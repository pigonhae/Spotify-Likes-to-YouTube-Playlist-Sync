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
  ) {
    super(message, 502);
  }
}

export class QuotaExceededError extends AppError {
  constructor(message = "YouTube quota exceeded") {
    super(message, 429);
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
