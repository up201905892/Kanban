import { describe, expect, it } from 'vitest';
import { DESCRIPTION_ACTIVITY_WINDOW_MS } from '@kanban/shared';
import { planDescriptionActivity } from './description.js';

const at = (ms: number) => new Date(1_700_000_000_000 + ms);

describe('planDescriptionActivity (coalescing of description_changed)', () => {
  it('creates an event when the person has none yet', () => {
    expect(planDescriptionActivity(null, { from: 0, to: 5 }, at(0))).toEqual({
      action: 'create',
      data: { from: 0, to: 5 },
    });
  });

  it('extends the previous event inside the window, keeping its original `from`', () => {
    const previous = { from: 3, to: 10, at: at(0) };
    expect(planDescriptionActivity(previous, { from: 10, to: 42 }, at(60_000))).toEqual({
      action: 'update',
      data: { from: 3, to: 42 },
    });
  });

  it('still coalesces exactly at the end of the window', () => {
    const previous = { from: 0, to: 1, at: at(0) };
    expect(
      planDescriptionActivity(previous, { from: 1, to: 2 }, at(DESCRIPTION_ACTIVITY_WINDOW_MS))
        .action,
    ).toBe('update');
  });

  it('starts a new event after the window', () => {
    const previous = { from: 0, to: 1, at: at(0) };
    expect(
      planDescriptionActivity(previous, { from: 1, to: 9 }, at(DESCRIPTION_ACTIVITY_WINDOW_MS + 1)),
    ).toEqual({ action: 'create', data: { from: 1, to: 9 } });
  });

  it('honours a custom window', () => {
    const previous = { from: 0, to: 1, at: at(0) };
    expect(planDescriptionActivity(previous, { from: 1, to: 2 }, at(1500), 1000).action).toBe(
      'create',
    );
  });
});
