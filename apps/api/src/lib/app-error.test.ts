import { describe, expect, it } from 'vitest';
import { apiErrorSchema, ErrorCode } from '@kanban/shared';
import { AppError, notFound, serializeError } from './app-error.js';

describe('serializeError', () => {
  it('maps an AppError to its status, code and message', () => {
    const r = serializeError(new AppError(409, ErrorCode.CONFLICT, 'Already exists'));
    expect(r.statusCode).toBe(409);
    expect(r.body).toEqual({ error: { code: 'CONFLICT', message: 'Already exists' } });
    expect(r.unexpected).toBe(false);
  });

  it('keeps AppError details', () => {
    const r = serializeError(
      new AppError(400, ErrorCode.VALIDATION_ERROR, 'Bad', [{ path: 'a', message: 'b' }]),
    );
    expect(r.body.error.details).toEqual([{ path: 'a', message: 'b' }]);
  });

  it('maps notFound() to 404 NOT_FOUND', () => {
    const r = serializeError(notFound());
    expect(r.statusCode).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
  });

  it('maps validation errors to 400 with dotted paths', () => {
    const err = Object.assign(new Error('x'), {
      validation: [
        { instancePath: '/user/name', message: 'Too short' },
        { instancePath: '', message: 'Required' },
      ],
    });
    const r = serializeError(err);
    expect(r.statusCode).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(r.body.error.details).toEqual([
      { path: 'user.name', message: 'Too short' },
      { path: '', message: 'Required' },
    ]);
  });

  it('maps framework 4xx errors to a generic 400', () => {
    const r = serializeError(Object.assign(new Error('Unexpected token'), { statusCode: 400 }));
    expect(r.statusCode).toBe(400);
    expect(r.body.error.message).toBe('Invalid request');
  });

  it('maps unknown errors to a generic 500 that leaks nothing', () => {
    const r = serializeError(new Error('SELECT * FROM secrets failed'));
    expect(r.statusCode).toBe(500);
    expect(r.unexpected).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain('SELECT');
    expect(apiErrorSchema.safeParse(r.body).success).toBe(true);
  });

  it('maps non-Error throws to 500', () => {
    expect(serializeError('boom').statusCode).toBe(500);
    expect(serializeError(null).statusCode).toBe(500);
  });
});
