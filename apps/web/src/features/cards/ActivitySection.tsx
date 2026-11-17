import { useEffect, useMemo, useRef, useState } from 'react';
import type { Column, Member } from '@kanban/shared';
import { Button, ErrorState, Spinner } from '../../components';
import { useCardActivity } from './api';
import {
  describeActivity,
  formatAbsoluteTime,
  formatRelativeTime,
  type ActivityNames,
} from './activity';

export interface ActivitySectionProps {
  cardId: string;
  columns: Column[];
  members: Member[];
}

/** "Activity": what happened to the card, newest first, with a "Load more" button (KB-024). */
export function ActivitySection({ cardId, columns, members }: ActivitySectionProps) {
  const activity = useCardActivity(cardId);
  const events = useMemo(
    () => activity.data?.pages.flatMap((p) => p.events) ?? [],
    [activity.data],
  );
  const names = useMemo<ActivityNames>(
    () => ({
      column: (id) => columns.find((c) => c.id === id)?.name,
      member: (id) => members.find((m) => m.userId === id)?.name,
    }),
    [columns, members],
  );
  // Relative times are computed once per render pass and refreshed every minute.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // "Load more" moves focus to the first newly loaded item.
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const focusIndex = useRef<number | null>(null);
  useEffect(() => {
    if (focusIndex.current !== null && events.length > focusIndex.current) {
      itemRefs.current[focusIndex.current]?.focus();
      focusIndex.current = null;
    }
  }, [events.length]);

  return (
    <section aria-labelledby={`activity-${cardId}`} className="activity-section">
      <h3 id={`activity-${cardId}`}>Activity</h3>
      {activity.isPending && <Spinner label="Loading activity" />}
      {activity.isError && !activity.data && (
        <ErrorState
          title="Activity unavailable"
          message={activity.error.message}
          onRetry={() => void activity.refetch()}
        />
      )}
      {activity.data && events.length === 0 && <p>No activity yet.</p>}
      {events.length > 0 && (
        <ul className="activity-list">
          {events.map((event, index) => (
            <li
              key={event.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              tabIndex={-1}
            >
              {describeActivity(event, names)} &middot;{' '}
              <time dateTime={event.createdAt} title={formatAbsoluteTime(event.createdAt)}>
                {formatRelativeTime(event.createdAt, now)}
              </time>
              <span className="sr-only"> ({formatAbsoluteTime(event.createdAt)})</span>
            </li>
          ))}
        </ul>
      )}
      {activity.hasNextPage && (
        <Button
          disabled={activity.isFetchingNextPage}
          onClick={() => {
            focusIndex.current = events.length;
            void activity.fetchNextPage();
          }}
        >
          {activity.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </section>
  );
}
