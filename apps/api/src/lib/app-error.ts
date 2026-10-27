import { ErrorCode, type ApiError, type ApiErrorDetail } from '@kanban/shared';

/** An expected error with a stable code and HTTP status; its message is safe to show to clients. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (message = 'Resource not found'): AppError =>
  new AppError(404, ErrorCode.NOT_FOUND, message);

export interface SerializedError {
  statusCode: number;
  body: ApiError;
  /** True when the error was not anticipated and must be logged in full. */
  unexpected: boolean;
}

interface ValidationIssue {
  instancePath?: string;
  message?: string;
}

const hasValidation = (err: unknown): err is { validation: ValidationIssue[] } =>
  typeof err === 'object' &&
  err !== null &&
  'validation' in err &&
  Array.isArray((err as { validation: unknown }).validation);

const hasStatus = (err: unknown): err is { statusCode: number } =>
  typeof err === 'object' &&
  err !== null &&
  typeof (err as { statusCode?: unknown }).statusCode === 'number';

const toPath = (instancePath: string | undefined): string =>
  (instancePath ?? '').replace(/^\//, '').replaceAll('/', '.');

/** Maps any thrown value to the A1 error format. Never exposes stacks or internal messages. */
export function serializeError(err: unknown): SerializedError {
  if (err instanceof AppError) {
    const error: ApiError['error'] = { code: err.code, message: err.message };
    if (err.details) error.details = err.details;
    return { statusCode: err.statusCode, body: { error }, unexpected: false };
  }
  if (hasValidation(err)) {
    const details = err.validation.map((v) => ({
      path: toPath(v.instancePath),
      message: v.message ?? 'Invalid value',
    }));
    return {
      statusCode: 400,
      body: { error: { code: ErrorCode.VALIDATION_ERROR, message: 'Invalid request', details } },
      unexpected: false,
    };
  }
  if (hasStatus(err) && err.statusCode >= 400 && err.statusCode < 500) {
    // Framework-level client errors (malformed JSON, payload too large, ...).
    return {
      statusCode: 400,
      body: { error: { code: ErrorCode.VALIDATION_ERROR, message: 'Invalid request' } },
      unexpected: false,
    };
  }
  return {
    statusCode: 500,
    body: { error: { code: ErrorCode.INTERNAL_ERROR, message: 'Internal server error' } },
    unexpected: true,
  };
}
