import type { ZodError } from 'zod';
import { isApiError } from '../../lib/api';

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export interface FormFailure<K extends string> {
  fields: FieldErrors<K>;
  /** Message not tied to a single field (wrong password, rate limit, network...). */
  form?: string;
}

/** First message per field from a Zod error (client-side validation). */
export function fieldErrorsFromZod<K extends string>(
  error: ZodError,
  known: readonly K[],
): FieldErrors<K> {
  const fields: FieldErrors<K> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0]) as K;
    if (known.includes(key) && !fields[key]) fields[key] = issue.message;
  }
  return fields;
}

/** Maps an API error to field errors (from `details`) and/or a form-level message. */
export function failureFromError<K extends string>(
  error: unknown,
  known: readonly K[],
  emailField?: K,
): FormFailure<K> {
  if (!isApiError(error)) return { fields: {}, form: 'Something went wrong. Please try again.' };
  const fields: FieldErrors<K> = {};
  for (const detail of error.details ?? []) {
    const key = detail.path.split('.')[0] as K;
    if (known.includes(key) && !fields[key]) fields[key] = detail.message;
  }
  if (error.code === 'EMAIL_TAKEN' && emailField) {
    fields[emailField] = error.message;
    return { fields };
  }
  if (Object.keys(fields).length > 0) return { fields };
  return { fields, form: error.message };
}
