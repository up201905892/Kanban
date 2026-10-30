import { z } from 'zod';
import { roleSchema } from './authz.js';

export const WORKSPACE_NAME_MAX_LENGTH = 80;

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(WORKSPACE_NAME_MAX_LENGTH, `Name must have at most ${WORKSPACE_NAME_MAX_LENGTH} characters`);

export const workspaceParamsSchema = z.strictObject({ id: z.uuid() });

export const createWorkspaceRequestSchema = z.strictObject({ name: workspaceNameSchema });
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

export const updateWorkspaceRequestSchema = z.strictObject({ name: workspaceNameSchema });
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;

/** Deleting a workspace requires repeating its name. */
export const deleteWorkspaceRequestSchema = z.strictObject({
  confirmName: z.string().max(200),
});
export type DeleteWorkspaceRequest = z.infer<typeof deleteWorkspaceRequestSchema>;

/** A workspace as seen by one user: includes that user's role. */
export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime(),
  role: roleSchema,
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspaceResponseSchema = z.object({ workspace: workspaceSchema });
export type WorkspaceResponse = z.infer<typeof workspaceResponseSchema>;

export const workspaceListResponseSchema = z.object({ workspaces: z.array(workspaceSchema) });
export type WorkspaceListResponse = z.infer<typeof workspaceListResponseSchema>;
