import type { CardPriority, Member } from '@kanban/shared';

export interface PriorityDisplay {
  /** A symbol that backs up the text; decorative (`aria-hidden`), never the only cue. */
  icon: string;
  label: string;
}

/** Icon and text for each priority, so it never depends on colour alone. */
export const PRIORITY_DISPLAY: Record<CardPriority, PriorityDisplay> = {
  none: { icon: '-', label: 'No priority' },
  low: { icon: '↓', label: 'Low' },
  medium: { icon: '=', label: 'Medium' },
  high: { icon: '↑', label: 'High' },
  urgent: { icon: '!!', label: 'Urgent' },
};

export const priorityDisplay = (priority: CardPriority): PriorityDisplay =>
  PRIORITY_DISPLAY[priority];

/** Up to two initials: first letters of the first and last word of the name. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return '?';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return (Array.from(first)[0] ?? '') + (last ? (Array.from(last)[0] ?? '') : '');
}

/** People who can be assigned: owners and members (viewers cannot). */
export const assignableMembers = (members: Member[]): Member[] =>
  members.filter((m) => m.role !== 'viewer');
