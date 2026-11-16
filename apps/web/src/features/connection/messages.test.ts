import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api';
import { pendingText, replayFailureMessage, sessionExpiredMessage } from './messages';

const notFound = new ApiError(404, 'NOT_FOUND', 'Resource not found');
const options = (queuedOffline: boolean) => ({
  queuedOffline,
  reference: 'Card KB-12',
  fallback: 'Could not move card',
});

describe('replayFailureMessage', () => {
  it('names a card deleted while the change waited offline', () => {
    expect(replayFailureMessage(notFound, options(true))).toBe(
      'Card KB-12 was deleted while you were offline',
    );
  });

  it('falls back for a 404 on a change that was sent online', () => {
    expect(replayFailureMessage(notFound, options(false))).toBe('Could not move card');
  });

  it('falls back for other errors, even offline ones', () => {
    expect(replayFailureMessage(new ApiError(409, 'CONFLICT', 'x'), options(true))).toBe(
      'Could not move card',
    );
    expect(replayFailureMessage(new Error('boom'), options(true))).toBe('Could not move card');
    expect(replayFailureMessage(undefined, options(true))).toBe('Could not move card');
  });
});

describe('texts', () => {
  it('counts pending changes', () => {
    expect(pendingText(1)).toBe('1 change pending');
    expect(pendingText(3)).toBe('3 changes pending');
  });

  it('says how many pending changes were not saved when the session expired', () => {
    expect(sessionExpiredMessage(2)).toBe('Your session expired; 2 pending changes were not saved');
    expect(sessionExpiredMessage(1)).toBe('Your session expired; 1 pending change was not saved');
    expect(sessionExpiredMessage(0)).toBe('Your session expired; please log in again');
  });
});
