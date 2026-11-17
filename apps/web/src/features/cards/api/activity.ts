import { activityListResponseSchema, type ActivityListResponse } from '@kanban/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api';
import { cardKey } from './cards';

/** Under `cardKey`, so invalidating the card (or every card) also refreshes its activity. */
export const activityKey = (cardId: string) => [...cardKey(cardId), 'activity'] as const;

/** Pages of a card's activity, newest first; `fetchNextPage` loads the next older page. */
export function useCardActivity(cardId: string) {
  return useInfiniteQuery<
    ActivityListResponse,
    Error,
    { pages: ActivityListResponse[] },
    readonly unknown[],
    string | null
  >({
    queryKey: activityKey(cardId),
    enabled: cardId !== '',
    initialPageParam: null,
    queryFn: ({ pageParam, signal }) => {
      const query = pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : '';
      return apiClient.get(
        `/api/cards/${cardId}/activity${query}`,
        activityListResponseSchema,
        signal,
      );
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}
