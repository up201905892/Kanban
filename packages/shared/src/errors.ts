import { z } from 'zod';

/** Every error code the API can return. Features add their own codes here. */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  CSRF_REJECTED: 'CSRF_REJECTED',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  PROJECT_KEY_TAKEN: 'PROJECT_KEY_TAKEN',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const errorCodeSchema = z.enum(ErrorCode);

export const apiErrorDetailSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export type ApiErrorDetail = z.infer<typeof apiErrorDetailSchema>;

/** Body of every error response: `{ error: { code, message, details? } }`. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.array(apiErrorDetailSchema).optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
