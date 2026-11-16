import {
  cardResponseSchema,
  sprintResponseSchema,
  sumPoints,
  type CardResponse,
  type CreateSprintRequest,
  type Sprint,
  type SprintResponse,
  type UpdateSprintRequest,
} from '@kanban/shared';
import { apiClient } from '../../../lib/api';
import { useBoardMutation } from '../../board/api';
import { sortSprints } from '../planning';

export interface CreateSprintVars extends CreateSprintRequest {
  /** Required on the client so a retry repeats the same create (A6). */
  id: string;
}

export function useCreateSprint(projectId: string) {
  return useBoardMutation<CreateSprintVars, SprintResponse>(
    projectId,
    (vars) => apiClient.post(`/api/projects/${projectId}/sprints`, vars, sprintResponseSchema),
    (board, vars) => {
      if (board.sprints.some((s) => s.id === vars.id)) return board;
      const sprint: Sprint = {
        id: vars.id,
        projectId,
        name: vars.name,
        goal: vars.goal ?? '',
        startDate: vars.startDate,
        endDate: vars.endDate,
        status: 'planned',
        committedPoints: null,
        completedPoints: null,
        closedAt: null,
        createdAt: new Date().toISOString(),
      };
      return { ...board, sprints: sortSprints([...board.sprints, sprint]) };
    },
  );
}

export interface UpdateSprintVars {
  id: string;
  patch: UpdateSprintRequest;
}

export function useUpdateSprint(projectId: string) {
  return useBoardMutation<UpdateSprintVars, SprintResponse>(
    projectId,
    ({ id, patch }) => apiClient.patch(`/api/sprints/${id}`, patch, sprintResponseSchema),
    (board, { id, patch }) => ({
      ...board,
      sprints: sortSprints(
        board.sprints.map((s) =>
          s.id === id
            ? {
                ...s,
                ...(patch.name !== undefined && { name: patch.name }),
                ...(patch.goal !== undefined && { goal: patch.goal }),
                ...(patch.startDate !== undefined && { startDate: patch.startDate }),
                ...(patch.endDate !== undefined && { endDate: patch.endDate }),
              }
            : s,
        ),
      ),
    }),
  );
}

/** Starts a planned sprint; the board shows it as active at once and rolls back if refused. */
export function useStartSprint(projectId: string) {
  return useBoardMutation<{ id: string }, SprintResponse>(
    projectId,
    ({ id }) => apiClient.post(`/api/sprints/${id}/start`, {}, sprintResponseSchema),
    (board, { id }) => ({
      ...board,
      sprints: board.sprints.map((s) =>
        s.id === id
          ? {
              ...s,
              status: 'active' as const,
              committedPoints: sumPoints(board.cards.filter((c) => c.sprintId === id)),
            }
          : s,
      ),
    }),
  );
}

export interface SetCardSprintVars {
  id: string;
  sprintId: string | null;
}

/** Adds a card to a sprint or returns it to the backlog (`null`). */
export function useSetCardSprint(projectId: string) {
  return useBoardMutation<SetCardSprintVars, CardResponse>(
    projectId,
    ({ id, sprintId }) =>
      apiClient.put(`/api/cards/${id}/sprint`, { sprintId }, cardResponseSchema),
    (board, { id, sprintId }) => ({
      ...board,
      cards: board.cards.map((c) => (c.id === id ? { ...c, sprintId } : c)),
    }),
  );
}
