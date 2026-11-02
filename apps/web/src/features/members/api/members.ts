import {
  memberListResponseSchema,
  memberResponseSchema,
  type Member,
  type MemberResponse,
  type Role,
} from '@kanban/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api';
import { workspaceKey, workspacesKey } from '../../workspaces/api';

export const membersKey = (workspaceId: string) => ['workspaces', workspaceId, 'members'] as const;

export function useMembers(workspaceId: string) {
  return useQuery({
    queryKey: membersKey(workspaceId),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get(
          `/api/workspaces/${workspaceId}/members`,
          memberListResponseSchema,
          signal,
        )
      ).members,
  });
}

interface Context {
  members: Member[] | undefined;
}

/** Optimistic role change: the select moves at once and goes back if the server refuses. */
export function useChangeMemberRole(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation<MemberResponse, Error, { userId: string; role: Role }, Context>({
    mutationFn: ({ userId, role }) =>
      apiClient.patch(
        `/api/workspaces/${workspaceId}/members/${userId}`,
        { role },
        memberResponseSchema,
      ),
    onMutate: async ({ userId, role }) => {
      await queryClient.cancelQueries({ queryKey: membersKey(workspaceId) });
      const members = queryClient.getQueryData<Member[]>(membersKey(workspaceId));
      queryClient.setQueryData<Member[]>(membersKey(workspaceId), (old) =>
        old?.map((m) => (m.userId === userId ? { ...m, role } : m)),
      );
      return { members };
    },
    onError: (_error, _vars, context) => {
      queryClient.setQueryData(membersKey(workspaceId), context?.members);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: membersKey(workspaceId) });
      // The caller's own role may have changed.
      void queryClient.invalidateQueries({ queryKey: workspaceKey(workspaceId), exact: true });
    },
  });
}

/** Optimistic removal (or leaving): the row disappears at once and returns on error. */
export function useRemoveMember(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { userId: string; leaving?: boolean }, Context>({
    mutationFn: async ({ userId }) => {
      await apiClient.delete(`/api/workspaces/${workspaceId}/members/${userId}`);
    },
    onMutate: async ({ userId }) => {
      await queryClient.cancelQueries({ queryKey: membersKey(workspaceId) });
      const members = queryClient.getQueryData<Member[]>(membersKey(workspaceId));
      queryClient.setQueryData<Member[]>(membersKey(workspaceId), (old) =>
        old?.filter((m) => m.userId !== userId),
      );
      return { members };
    },
    onError: (_error, _vars, context) => {
      queryClient.setQueryData(membersKey(workspaceId), context?.members);
    },
    onSettled: (_data, error, { leaving }) => {
      if (leaving && !error) {
        // After leaving, the workspace is a 404 for this person: do not refetch it.
        queryClient.removeQueries({ queryKey: ['workspaces', workspaceId] });
        void queryClient.invalidateQueries({ queryKey: workspacesKey, exact: true });
        return;
      }
      void queryClient.invalidateQueries({ queryKey: membersKey(workspaceId) });
    },
  });
}
