import { describe, expect, it } from 'vitest';
import { remoteState } from '../../test-utils/presence';
import {
  editingLabel,
  othersEditing,
  othersOnCard,
  peopleListLabel,
  toPresentPeople,
} from './view-model';

const CARD = '8c0e3f4e-4b0a-4a53-9a39-0f5d0c4e8a11';
const OTHER = '8c0e3f4e-4b0a-4a53-9a39-0f5d0c4e8a12';

describe('toPresentPeople', () => {
  it('shows one person for several tabs of the same user and merges their cards', () => {
    const people = toPresentPeople(
      new Map<number, unknown>([
        [1, remoteState('u-ana', 'Ana', { activeCardId: CARD, editing: true })],
        [2, remoteState('u-ana', 'Ana', { activeCardId: OTHER })],
        [3, remoteState('u-bo', 'Bo')],
      ]),
      'u-bo',
    );
    expect(people.map((p) => p.name)).toEqual(['Ana', 'Bo']);
    const ana = people[0];
    expect(ana?.openCardIds.sort()).toEqual([CARD, OTHER].sort());
    expect(ana?.editingCardIds).toEqual([CARD]);
    expect(people[1]?.isSelf).toBe(true);
  });

  it('ignores states that do not match the schema', () => {
    const people = toPresentPeople(
      new Map<number, unknown>([
        [1, { name: 'broken' }],
        [2, null],
        [3, remoteState('u-ana', 'Ana')],
      ]),
      null,
    );
    expect(people.map((p) => p.userId)).toEqual(['u-ana']);
  });

  it('does not count "editing" without an open card', () => {
    const [person] = toPresentPeople(
      new Map<number, unknown>([[1, remoteState('u-ana', 'Ana', { editing: true })]]),
      null,
    );
    expect(person?.editingCardIds).toEqual([]);
  });
});

describe('card helpers and labels', () => {
  const people = toPresentPeople(
    new Map<number, unknown>([
      [1, remoteState('me', 'Me', { activeCardId: CARD, editing: true })],
      [2, remoteState('u-ana', 'Ana', { activeCardId: CARD, editing: true })],
      [3, remoteState('u-bo', 'Bo', { activeCardId: CARD })],
    ]),
    'me',
  );

  it('leaves the current user out of "others"', () => {
    expect(othersOnCard(people, CARD).map((p) => p.name)).toEqual(['Ana', 'Bo']);
    expect(othersEditing(people, CARD).map((p) => p.name)).toEqual(['Ana']);
    expect(othersEditing(people, OTHER)).toEqual([]);
  });

  it('words the editing label for one, two and many people', () => {
    expect(editingLabel(['Ana'])).toBe('Ana is editing');
    expect(editingLabel(['Ana', 'Bo'])).toBe('Ana and Bo are editing');
    expect(editingLabel(['Ana', 'Bo', 'Cy', 'Di'])).toBe('Ana and 3 others are editing');
    expect(editingLabel([])).toBe('');
  });

  it('words the accessible list label', () => {
    expect(peopleListLabel(people)).toBe('3 people on this board: Ana, Bo, Me (you)');
    expect(peopleListLabel(people.slice(0, 1))).toBe('1 person on this board: Ana');
  });
});
