import {
  cardResponseSchema,
  labelResponseSchema,
  type CardResponse,
  type CreateLabelRequest,
  type LabelResponse,
  type UpdateLabelRequest,
} from '@kanban/shared';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient, request } from '../../../lib/api';
import { useBoardMutation } from '../../board/api';
import { activityKey, cardKey } from '../../cards/api';
import { removeLabel, setCardLabelIds, sortLabels, upsertLabel } from '../labels';

export interface CreateLabelVars extends CreateLabelRequest {
  /** Required on the client so a retry repeats the same create (A6). */
  id: string;
}

export function useCreateLabel(projectId: string) {
  return useBoardMutation<CreateLabelVars, LabelResponse>(
    projectId,
    (vars) => apiClient.post(`/api/projects/${projectId}/labels`, vars, labelResponseSchema),
    (board, vars) =>
      board.labels.some((l) => l.id === vars.id)
        ? board
        : {
            ...board,
            labels: sortLabels([
              ...board.labels,
              { id: vars.id, projectId, name: vars.name, color: vars.color },
            ]),
          },
  );
}

export interface UpdateLabelVars {
  id: string;
  patch: UpdateLabelRequest;
}

export function useUpdateLabel(projectId: string) {
  return useBoardMutation<UpdateLabelVars, LabelResponse>(
    projectId,
    ({ id, patch }) => apiClient.patch(`/api/labels/${id}`, patch, labelResponseSchema),
    (board, { id, patch }) => {
      const current = board.labels.find((l) => l.id === id);
      if (!current) return board;
      return upsertLabel(board, {
        ...current,
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.color !== undefined && { color: patch.color }),
      });
    },
  );
}

export function useDeleteLabel(projectId: string) {
  return useBoardMutation<string, void>(
    projectId,
    (id) => request(`/api/labels/${id}`, { method: 'DELETE' }),
    (board, id) => removeLabel(board, id),
  );
}

export interface SetCardLabelsVars {
  cardId: string;
  labelIds: string[];
}

/** The card's whole label set; the tile and the dialog show it at once and roll back on error. */
export function useSetCardLabels(projectId: string) {
  const queryClient = useQueryClient();
  return useBoardMutation<SetCardLabelsVars, CardResponse>(
    projectId,
    async ({ cardId, labelIds }) => {
      const result = await apiClient.put(
        `/api/cards/${cardId}/labels`,
        { labelIds },
        cardResponseSchema,
      );
      // The dialog's copy and the history changed too.
      void queryClient.invalidateQueries({ queryKey: cardKey(cardId) });
      void queryClient.invalidateQueries({ queryKey: activityKey(cardId) });
      return result;
    },
    (board, { cardId, labelIds }) => setCardLabelIds(board, cardId, labelIds),
  );
}
