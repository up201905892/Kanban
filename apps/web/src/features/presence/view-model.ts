import { awarenessStateSchema, type AwarenessState } from '@kanban/shared';

/** One person on the board, however many tabs or devices they have open. */
export interface PresentPerson {
  userId: string;
  name: string;
  color: string;
  isSelf: boolean;
  /** Cards this person has open in a dialog. */
  openCardIds: string[];
  /** Cards whose description this person is editing. */
  editingCardIds: string[];
}

/**
 * Turns the raw awareness states of the board room into people, deduplicated by user (the same
 * person in two tabs is one person). Invalid states are ignored; people are sorted by name, with
 * the current user kept in the list and marked `isSelf`.
 */
export function toPresentPeople(
  states: ReadonlyMap<number, unknown>,
  selfUserId: string | null,
): PresentPerson[] {
  const byUser = new Map<string, PresentPerson>();
  for (const state of states.values()) {
    const parsed = awarenessStateSchema.safeParse(state);
    if (!parsed.success) continue;
    const { userId, name, color, activeCardId, editing }: AwarenessState = parsed.data;
    let person = byUser.get(userId);
    if (!person) {
      person = {
        userId,
        name,
        color,
        isSelf: userId === selfUserId,
        openCardIds: [],
        editingCardIds: [],
      };
      byUser.set(userId, person);
    }
    if (activeCardId !== null) {
      if (!person.openCardIds.includes(activeCardId)) person.openCardIds.push(activeCardId);
      if (editing && !person.editingCardIds.includes(activeCardId)) {
        person.editingCardIds.push(activeCardId);
      }
    }
  }
  return [...byUser.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId),
  );
}

/** Other people (not the current user) who have `cardId` open. */
export const othersOnCard = (people: PresentPerson[], cardId: string): PresentPerson[] =>
  people.filter((p) => !p.isSelf && p.openCardIds.includes(cardId));

/** Other people editing the description of `cardId`. */
export const othersEditing = (people: PresentPerson[], cardId: string): PresentPerson[] =>
  people.filter((p) => !p.isSelf && p.editingCardIds.includes(cardId));

/** "Ana is editing", "Ana and Bo are editing", "Ana and 2 others are editing". */
export function editingLabel(names: string[]): string {
  const [first, second] = names;
  if (first === undefined) return '';
  if (second === undefined) return `${first} is editing`;
  if (names.length === 2) return `${first} and ${second} are editing`;
  return `${first} and ${names.length - 1} others are editing`;
}

/** The accessible name of the board's people list: "3 people on this board: Ana (you), Bo, Cy". */
export function peopleListLabel(people: PresentPerson[]): string {
  const names = people.map((p) => (p.isSelf ? `${p.name} (you)` : p.name)).join(', ');
  return `${people.length} ${people.length === 1 ? 'person' : 'people'} on this board: ${names}`;
}
