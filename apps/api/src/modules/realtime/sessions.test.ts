import { describe, expect, it, vi } from 'vitest';
import { findEndedSessions } from './sessions.js';

describe('findEndedSessions', () => {
  it('asks the database once for N sockets and returns the missing ids', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 's1' }, { id: 's3' }]);
    const ended = await findEndedSessions({ session: { findMany } } as never, [
      's1',
      's2',
      's3',
      's1',
      's2',
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect([...ended]).toEqual(['s2']);
  });

  it('does not query when no socket is open', async () => {
    const findMany = vi.fn();
    expect((await findEndedSessions({ session: { findMany } } as never, [])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
