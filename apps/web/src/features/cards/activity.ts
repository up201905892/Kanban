import type { ActivityEntry } from '@kanban/shared';

export interface ActivityNames {
  /** Name of a column, or undefined when it no longer exists. */
  column: (id: string) => string | undefined;
  /** Name of a workspace member, or undefined when they are no longer one. */
  member: (id: string) => string | undefined;
}

const quote = (text: string): string => `“${text}”`;
const estimateText = (value: number | null): string =>
  value === null ? 'no estimate' : `${value} ${value === 1 ? 'point' : 'points'}`;

/**
 * The sentence for one event ("Ana moved this card from To do to In progress"), without the time.
 * The switch is exhaustive over the shared event union: a new event type fails the typecheck here
 * until it has a renderer. Description changes show lengths only, never the text.
 */
export function describeActivity(entry: ActivityEntry, names: ActivityNames): string {
  const who = entry.actor.name;
  const column = (id: string, recorded?: string) =>
    names.column(id) ?? recorded ?? 'a deleted column';
  const person = (id: string | null) =>
    id === null ? 'nobody' : (names.member(id) ?? 'a former member');
  switch (entry.type) {
    case 'created':
      return `${who} created this card in ${column(entry.data.column.columnId, entry.data.column.columnName)}`;
    case 'title_changed':
      return `${who} changed the title from ${quote(entry.data.from)} to ${quote(entry.data.to)}`;
    case 'description_changed':
      return `${who} edited the description (${entry.data.from} to ${entry.data.to} characters)`;
    case 'deleted':
      return `${who} deleted this card`;
    case 'column_deleted_moved':
      return `${who} deleted the column ${quote(entry.data.from.columnName)}, which moved this card to ${column(entry.data.to.columnId, entry.data.to.columnName)}`;
    case 'moved':
      return `${who} moved this card from ${column(entry.data.fromColumnId)} to ${column(entry.data.toColumnId)}`;
    case 'assignee_changed':
      if (entry.data.to === null)
        return `${who} unassigned ${person(entry.data.from)} from this card`;
      return entry.data.from === null
        ? `${who} assigned this card to ${person(entry.data.to)}`
        : `${who} reassigned this card from ${person(entry.data.from)} to ${person(entry.data.to)}`;
    case 'priority_changed':
      return `${who} changed the priority from ${entry.data.from} to ${entry.data.to}`;
    case 'estimate_changed':
      return `${who} changed the estimate from ${estimateText(entry.data.from)} to ${estimateText(entry.data.to)}`;
    case 'sprint_added':
      return `${who} added this card to ${entry.data.sprintName}`;
    case 'sprint_removed':
      return entry.data.reason === 'sprint_closed'
        ? `${entry.data.sprintName} was closed and this card went back to the backlog`
        : `${who} removed this card from ${entry.data.sprintName}`;
    case 'labels_changed': {
      const names = (list: { name: string }[]) => list.map((l) => quote(l.name)).join(', ');
      const noun = (list: unknown[]) => (list.length === 1 ? 'label' : 'labels');
      const parts = [
        entry.data.added.length > 0
          ? `added ${noun(entry.data.added)} ${names(entry.data.added)}`
          : '',
        entry.data.removed.length > 0
          ? `removed ${noun(entry.data.removed)} ${names(entry.data.removed)}`
          : '',
      ].filter((part) => part !== '');
      return `${who} ${parts.join(' and ')}`;
    }
    default: {
      const unhandled: never = entry;
      return String(unhandled);
    }
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "2 h ago", "3 days ago"; older than 30 days shows the date. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const elapsed = now.getTime() - then.getTime();
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  if (elapsed < 30 * DAY) {
    const days = Math.floor(elapsed / DAY);
    return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  }
  return then.toISOString().slice(0, 10);
}

/** The absolute date for the `<time>` title and text alternative, in UTC. */
export const formatAbsoluteTime = (iso: string): string =>
  `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
