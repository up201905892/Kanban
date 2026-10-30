import {
  projectListResponseSchema,
  projectResponseSchema,
  type CreateProjectRequest,
  type Project,
  type ProjectResponse,
  type UpdateProjectRequest,
} from '@kanban/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, request } from '../../../lib/api';

export const projectsKey = (workspaceId: string) =>
  ['workspaces', workspaceId, 'projects'] as const;
export const projectKey = (id: string) => ['projects', id] as const;

export function useProjects(workspaceId: string) {
  return useQuery({
    queryKey: projectsKey(workspaceId),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get(
          `/api/workspaces/${workspaceId}/projects`,
          projectListResponseSchema,
          signal,
        )
      ).projects,
  });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: projectKey(id),
    queryFn: async ({ signal }) =>
      (await apiClient.get(`/api/projects/${id}`, projectResponseSchema, signal)).project,
  });
}

export function useCreateProject(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation<ProjectResponse, Error, CreateProjectRequest>({
    mutationFn: (body) =>
      apiClient.post(`/api/workspaces/${workspaceId}/projects`, body, projectResponseSchema),
    onSuccess: ({ project }) => {
      queryClient.setQueryData(projectKey(project.id), project);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: projectsKey(workspaceId) }),
  });
}

interface RenameContext {
  list: Project[] | undefined;
  detail: Project | undefined;
}

/** Optimistic rename: the name changes at once and is restored if the server refuses. */
export function useRenameProject(project: Project) {
  const queryClient = useQueryClient();
  const listKey = projectsKey(project.workspaceId);
  return useMutation<ProjectResponse, Error, UpdateProjectRequest, RenameContext>({
    mutationFn: (body) =>
      apiClient.patch(`/api/projects/${project.id}`, body, projectResponseSchema),
    onMutate: async ({ name }) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      await queryClient.cancelQueries({ queryKey: projectKey(project.id) });
      const context: RenameContext = {
        list: queryClient.getQueryData<Project[]>(listKey),
        detail: queryClient.getQueryData<Project>(projectKey(project.id)),
      };
      queryClient.setQueryData<Project[]>(listKey, (old) =>
        old?.map((p) => (p.id === project.id ? { ...p, name } : p)),
      );
      queryClient.setQueryData<Project>(projectKey(project.id), (old) => old && { ...old, name });
      return context;
    },
    onError: (_error, _body, context) => {
      queryClient.setQueryData(listKey, context?.list);
      queryClient.setQueryData(projectKey(project.id), context?.detail);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: listKey });
      await queryClient.invalidateQueries({ queryKey: projectKey(project.id) });
    },
  });
}

/** Optimistic delete: the project leaves the list at once and returns if the server refuses. */
export function useDeleteProject(project: Project) {
  const queryClient = useQueryClient();
  const listKey = projectsKey(project.workspaceId);
  return useMutation<void, Error, void, { list: Project[] | undefined }>({
    mutationFn: async () => {
      await request(`/api/projects/${project.id}`, { method: 'DELETE' });
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const list = queryClient.getQueryData<Project[]>(listKey);
      queryClient.setQueryData<Project[]>(listKey, (old) =>
        old?.filter((p) => p.id !== project.id),
      );
      return { list };
    },
    onError: (_error, _body, context) => {
      queryClient.setQueryData(listKey, context?.list);
    },
    // Only the list is refreshed: refetching the deleted project itself would be a 404.
    onSettled: () => {
      queryClient.removeQueries({ queryKey: projectKey(project.id) });
      return queryClient.invalidateQueries({ queryKey: listKey });
    },
  });
}
