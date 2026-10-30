import {
  workspaceListResponseSchema,
  workspaceResponseSchema,
  type DeleteWorkspaceRequest,
  type UpdateWorkspaceRequest,
  type CreateWorkspaceRequest,
  type Workspace,
  type WorkspaceResponse,
} from '@kanban/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, request } from '../../../lib/api';

export const workspacesKey = ['workspaces'] as const;
export const workspaceKey = (id: string) => ['workspaces', id] as const;

export function useWorkspaces() {
  return useQuery({
    queryKey: workspacesKey,
    queryFn: async ({ signal }) =>
      (await apiClient.get('/api/workspaces', workspaceListResponseSchema, signal)).workspaces,
  });
}

export function useWorkspace(id: string) {
  return useQuery({
    queryKey: workspaceKey(id),
    queryFn: async ({ signal }) =>
      (await apiClient.get(`/api/workspaces/${id}`, workspaceResponseSchema, signal)).workspace,
  });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation<WorkspaceResponse, Error, CreateWorkspaceRequest>({
    mutationFn: (body) => apiClient.post('/api/workspaces', body, workspaceResponseSchema),
    onSuccess: ({ workspace }) => {
      queryClient.setQueryData(workspaceKey(workspace.id), workspace);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: workspacesKey, exact: true }),
  });
}

interface RenameContext {
  list: Workspace[] | undefined;
  detail: Workspace | undefined;
}

/** Optimistic rename: the name changes at once and is restored if the server refuses. */
export function useRenameWorkspace(id: string) {
  const queryClient = useQueryClient();
  return useMutation<WorkspaceResponse, Error, UpdateWorkspaceRequest, RenameContext>({
    mutationFn: (body) => apiClient.patch(`/api/workspaces/${id}`, body, workspaceResponseSchema),
    onMutate: async ({ name }) => {
      await queryClient.cancelQueries({ queryKey: workspacesKey });
      const context: RenameContext = {
        list: queryClient.getQueryData<Workspace[]>(workspacesKey),
        detail: queryClient.getQueryData<Workspace>(workspaceKey(id)),
      };
      queryClient.setQueryData<Workspace[]>(workspacesKey, (old) =>
        old?.map((w) => (w.id === id ? { ...w, name } : w)),
      );
      queryClient.setQueryData<Workspace>(workspaceKey(id), (old) => old && { ...old, name });
      return context;
    },
    onError: (_error, _body, context) => {
      queryClient.setQueryData(workspacesKey, context?.list);
      queryClient.setQueryData(workspaceKey(id), context?.detail);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: workspacesKey }),
  });
}

/** Optimistic delete: the workspace leaves the list at once and returns if the server refuses. */
export function useDeleteWorkspace(id: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, DeleteWorkspaceRequest, { list: Workspace[] | undefined }>({
    mutationFn: async (body) => {
      await request(`/api/workspaces/${id}`, { method: 'DELETE', body });
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: workspacesKey, exact: true });
      const list = queryClient.getQueryData<Workspace[]>(workspacesKey);
      queryClient.setQueryData<Workspace[]>(workspacesKey, (old) =>
        old?.filter((w) => w.id !== id),
      );
      return { list };
    },
    onError: (_error, _body, context) => {
      queryClient.setQueryData(workspacesKey, context?.list);
    },
    // Only the list is refreshed: refetching the deleted workspace itself would be a 404.
    onSettled: () => queryClient.invalidateQueries({ queryKey: workspacesKey, exact: true }),
  });
}
