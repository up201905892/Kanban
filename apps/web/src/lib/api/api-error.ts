import type { ApiErrorDetail, ErrorCode } from '@kanban/shared';

/** Error thrown by `apiClient`; `code` is an API error code or a client-side one. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE';
  readonly details: ApiErrorDetail[] | undefined;

  constructor(status: number, code: ApiError['code'], message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
