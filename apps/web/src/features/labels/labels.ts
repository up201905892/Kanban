import { diffLabelIds, type BoardResponse, type Label, type LabelColor } from '@kanban/shared';

/** Labels in the order people see them: by name, ignoring case, then by id. */
export function sortLabels(labels: readonly Label[]): Label[] {
  return [...labels].sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id),
  );
}

/** The labels a card carries, in label order; ids of labels that no longer exist are skipped. */
export function labelsOfCard(labelIds: readonly string[], labels: readonly Label[]): Label[] {
  const wanted = new Set(labelIds);
  return sortLabels(labels).filter((l) => wanted.has(l.id));
}

/** Insert or replace a label. */
export function upsertLabel(board: BoardResponse, label: Label): BoardResponse {
  const others = board.labels.filter((l) => l.id !== label.id);
  return { ...board, labels: sortLabels([...others, label]) };
}

/** Remove a label from the board and from every card that carried it. */
export function removeLabel(board: BoardResponse, labelId: string): BoardResponse {
  if (
    !board.labels.some((l) => l.id === labelId) &&
    !board.cards.some((c) => hasLabel(c, labelId))
  ) {
    return board;
  }
  return {
    ...board,
    labels: board.labels.filter((l) => l.id !== labelId),
    cards: board.cards.map((c) =>
      hasLabel(c, labelId) ? { ...c, labelIds: c.labelIds.filter((id) => id !== labelId) } : c,
    ),
  };
}

const hasLabel = (card: { labelIds: string[] }, labelId: string): boolean =>
  card.labelIds.includes(labelId);

/** Show a new label set on one card at once. */
export function setCardLabelIds(
  board: BoardResponse,
  cardId: string,
  labelIds: readonly string[],
): BoardResponse {
  return {
    ...board,
    cards: board.cards.map((c) => (c.id === cardId ? { ...c, labelIds: [...labelIds] } : c)),
  };
}

/** The set after turning one label on or off, in a stable order. */
export function toggleLabelId(current: readonly string[], labelId: string, on: boolean): string[] {
  const without = current.filter((id) => id !== labelId);
  return on ? [...without, labelId] : without;
}

/** What changed between two sets, as a sentence for the announcer. */
export function describeLabelChange(
  before: readonly string[],
  after: readonly string[],
  labels: readonly Label[],
): string {
  const { added, removed } = diffLabelIds(before, after);
  const name = (id: string) => labels.find((l) => l.id === id)?.name ?? 'label';
  if (added.length > 0) return `Label ${name(added[0] as string)} added`;
  if (removed.length > 0) return `Label ${name(removed[0] as string)} removed`;
  return 'Labels unchanged';
}

/** Human names of the palette tokens (the colour is never the only cue; the name is always shown). */
export const COLOR_NAMES: Readonly<Record<LabelColor, string>> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  teal: 'Teal',
  blue: 'Blue',
  purple: 'Purple',
  gray: 'Gray',
};
