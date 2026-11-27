import { describe, expect, it } from 'vitest';
import type { BoardEvent, BoardResponse, Label } from '@kanban/shared';
import { applyBoardEvent } from '../board/board-events';
import {
  describeLabelChange,
  labelsOfCard,
  removeLabel,
  setCardLabelIds,
  sortLabels,
  toggleLabelId,
  upsertLabel,
} from './labels';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PROJECT = id(3);
const label = (n: number, name: string, color: Label['color'] = 'red'): Label => ({
  id: id(500 + n),
  projectId: PROJECT,
  name,
  color,
});

const board = (): BoardResponse => ({
  board: { id: id(1), projectId: PROJECT },
  columns: [],
  cards: [
    {
      id: id(200),
      columnId: id(100),
      number: 1,
      title: 'One',
      position: 'a0',
      version: 1,
      assigneeId: null,
      priority: 'none',
      estimate: null,
      sprintId: null,
      labelIds: [id(501), id(502)],
    },
  ],
  sprints: [],
  labels: [label(1, 'Bug'), label(2, 'Feature', 'blue')],
});

const base = { boardId: id(1), actorId: id(9), at: '2026-11-27T10:00:00.000Z' };

describe('label helpers', () => {
  it('sorts by name ignoring case', () => {
    expect(
      sortLabels([label(1, 'beta'), label(2, 'Alpha'), label(3, 'Gamma')]).map((l) => l.name),
    ).toEqual(['Alpha', 'beta', 'Gamma']);
  });

  it('lists the labels of a card and skips unknown ids', () => {
    const all = [label(1, 'Bug'), label(2, 'Feature')];
    expect(labelsOfCard([id(502), id(999)], all).map((l) => l.name)).toEqual(['Feature']);
  });

  it('toggles an id on and off without duplicates', () => {
    expect(toggleLabelId(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleLabelId(['a', 'b'], 'b', true)).toEqual(['a', 'b']);
    expect(toggleLabelId(['a', 'b'], 'a', false)).toEqual(['b']);
  });

  it('upserts, removes (also from cards) and sets a card label set', () => {
    const b = upsertLabel(board(), label(1, 'Defect', 'green'));
    expect(b.labels.map((l) => l.name)).toEqual(['Defect', 'Feature']);
    const removed = removeLabel(board(), id(501));
    expect(removed.labels.map((l) => l.name)).toEqual(['Feature']);
    expect(removed.cards[0]?.labelIds).toEqual([id(502)]);
    const set = setCardLabelIds(board(), id(200), []);
    expect(set.cards[0]?.labelIds).toEqual([]);
  });

  it('describes what changed for the announcer', () => {
    const all = [label(1, 'Bug'), label(2, 'Feature')];
    expect(describeLabelChange([], [id(501)], all)).toBe('Label Bug added');
    expect(describeLabelChange([id(501)], [], all)).toBe('Label Bug removed');
  });
});

describe('label board events', () => {
  it('label_created and label_updated upsert in name order; label_deleted removes everywhere', () => {
    const created: BoardEvent = {
      type: 'label_created',
      ...base,
      entity: label(3, 'Alpha', 'teal'),
      version: null,
    };
    const afterCreate = applyBoardEvent(board(), created);
    expect(afterCreate.labels.map((l) => l.name)).toEqual(['Alpha', 'Bug', 'Feature']);

    const updated: BoardEvent = {
      type: 'label_updated',
      ...base,
      entity: label(1, 'Bug', 'purple'),
      version: null,
    };
    expect(applyBoardEvent(afterCreate, updated).labels.find((l) => l.name === 'Bug')?.color).toBe(
      'purple',
    );

    const deleted: BoardEvent = {
      type: 'label_deleted',
      ...base,
      entity: { id: id(501), name: 'Bug' },
      version: null,
    };
    const afterDelete = applyBoardEvent(board(), deleted);
    expect(afterDelete.labels.map((l) => l.name)).toEqual(['Feature']);
    expect(afterDelete.cards[0]?.labelIds).toEqual([id(502)]);
    // Applying it again changes nothing (idempotent).
    expect(applyBoardEvent(afterDelete, deleted)).toBe(afterDelete);
  });

  it('a card_updated event brings the new label ids', () => {
    const current = board();
    const card = current.cards[0];
    if (!card) throw new Error('no card');
    const event: BoardEvent = {
      type: 'card_updated',
      ...base,
      entity: { ...card, version: 2, labelIds: [id(502)] },
      version: 2,
    };
    expect(applyBoardEvent(current, event).cards[0]?.labelIds).toEqual([id(502)]);
  });
});
