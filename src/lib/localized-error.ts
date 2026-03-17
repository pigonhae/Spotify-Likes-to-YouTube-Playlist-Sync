import { AppError } from "./errors.js";
import type { TranslationParams } from "./i18n.js";

export class LocalizedError extends AppError {
  constructor(
    message: string,
    statusCode: number,
    public readonly messageKey: string,
    public readonly messageParams?: TranslationParams,
  ) {
    super(message, statusCode);
  }
}
