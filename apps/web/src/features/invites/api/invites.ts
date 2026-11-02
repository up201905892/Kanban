import {
  acceptInviteResponseSchema,
  createInviteResponseSchema,
  inviteListResponseSchema,
  invitePreviewSchema,
  type AcceptInviteResponse,
  type CreateInviteRequest,
  type CreateInviteResponse,
  type Invite,
} from '@kanban/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api';
import { workspacesKey } from '../../workspaces/api';

export const invitesKey = (workspaceId: string) => ['workspaces', workspaceId, 'invites'] as const;
export const invitePreviewKey = (token: string) => ['invite-preview', token] as const;

/** Public preview: no session needed. A 404 is a final answer, so it is not retried. */
export function useInvitePreview(token: string) {
  return useQuery({
    queryKey: invitePreviewKey(token),
    queryFn: ({ signal }) =>
      apiClient.get(`/api/invites/${encodeURIComponent(token)}`, invitePreviewSchema, signal),
    retry: false,
  });
}

export function useAcceptInvite(token: string) {
  const queryClient = useQueryClient();
  return useMutation<AcceptInviteResponse, Error, void>({
    mutationFn: () =>
      apiClient.post(
        `/api/invites/${encodeURIComponent(token)}/accept`,
        undefined,
        acceptInviteResponseSchema,
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: workspacesKey, exact: true }),
  });
}

export function useInvites(workspaceId: string) {
  return useQuery({
    queryKey: invitesKey(workspaceId),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get(
          `/api/workspaces/${workspaceId}/invites`,
          inviteListResponseSchema,
          signal,
        )
      ).invites,
  });
}

export function useCreateInvite(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation<CreateInviteResponse, Error, CreateInviteRequest>({
    mutationFn: (body) =>
      apiClient.post(`/api/workspaces/${workspaceId}/invites`, body, createInviteResponseSchema),
    onSettled: () => queryClient.invalidateQueries({ queryKey: invitesKey(workspaceId) }),
  });
}

/** Optimistic revoke: the invite leaves the list at once and returns if the server refuses. */
export function useRevokeInvite(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string, { invites: Invite[] | undefined }>({
    mutationFn: async (inviteId) => {
      await apiClient.delete(`/api/invites/${inviteId}`);
    },
    onMutate: async (inviteId) => {
      await queryClient.cancelQueries({ queryKey: invitesKey(workspaceId) });
      const invites = queryClient.getQueryData<Invite[]>(invitesKey(workspaceId));
      queryClient.setQueryData<Invite[]>(invitesKey(workspaceId), (old) =>
        old?.filter((i) => i.id !== inviteId),
      );
      return { invites };
    },
    onError: (_error, _id, context) => {
      queryClient.setQueryData(invitesKey(workspaceId), context?.invites);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: invitesKey(workspaceId) }),
  });
}
