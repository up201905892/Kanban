import { burndownResponseSchema } from '@kanban/shared';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api';

export const burndownKey = (sprintId: string) => ['sprints', sprintId, 'burndown'] as const;

/** Burndown of one sprint; an empty id keeps the query off. */
export function useBurndown(sprintId: string) {
  return useQuery({
    queryKey: burndownKey(sprintId),
    enabled: sprintId !== '',
    queryFn: ({ signal }) =>
      apiClient.get(`/api/sprints/${sprintId}/burndown`, burndownResponseSchema, signal),
  });
}
