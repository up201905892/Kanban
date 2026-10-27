import { apiErrorSchema } from '@kanban/shared';
import type { ZodType, z } from 'zod';
import { ApiError } from './api-error';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions<S extends ZodType | undefined> {
  method?: Method;
  /** JSON request body (validate it with a shared schema before calling). */
  body?: unknown;
  /** Shared schema for the response body. Omit for 204 / empty responses. */
  schema?: S;
  signal?: AbortSignal;
}

type Result<S extends ZodType | undefined> = S extends ZodType ? z.infer<S> : undefined;

export async function request<S extends ZodType | undefined = undefined>(
  path: string,
  options: RequestOptions<S> = {},
): Promise<Result<S>> {
  const { method = 'GET', body, schema, signal } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    const init: RequestInit = { method, headers, credentials: 'include' };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (signal) init.signal = signal;
    response = await fetch(path, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection.');
  }

  const text = await response.text();
  let json: unknown;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError(response.status, code, message, details);
    }
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      `Unexpected server response (${response.status}).`,
    );
  }

  if (!schema) return undefined as Result<S>;
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      'The server response did not match the expected format.',
    );
  }
  return parsed.data as Result<S>;
}

export const apiClient = {
  request,
  get: <S extends ZodType | undefined>(path: string, schema?: S, signal?: AbortSignal) =>
    request<S>(path, { method: 'GET', ...(schema && { schema }), ...(signal && { signal }) }),
  post: <S extends ZodType | undefined>(path: string, body?: unknown, schema?: S) =>
    request<S>(path, { method: 'POST', body, ...(schema && { schema }) }),
  patch: <S extends ZodType | undefined>(path: string, body?: unknown, schema?: S) =>
    request<S>(path, { method: 'PATCH', body, ...(schema && { schema }) }),
  delete: <S extends ZodType | undefined>(path: string, schema?: S) =>
    request<S>(path, { method: 'DELETE', ...(schema && { schema }) }),
};
