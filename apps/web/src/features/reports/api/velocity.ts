import { velocityResponseSchema } from '@kanban/shared';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api';

export const velocityKey = (projectId: string) => ['projects', projectId, 'velocity'] as const;

/** Committed vs completed points of the last closed sprints; refetched on mount because closing a sprint changes it. */
export function useVelocity(projectId: string) {
  return useQuery({
    queryKey: velocityKey(projectId),
    refetchOnMount: 'always',
    queryFn: ({ signal }) =>
      apiClient.get(`/api/projects/${projectId}/velocity`, velocityResponseSchema, signal),
  });
}
