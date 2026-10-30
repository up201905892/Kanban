import { z } from 'zod';
import { workspaceNameSchema } from './workspaces.js';

export const PROJECT_NAME_MAX_LENGTH = 80;
export const PROJECT_KEY_MIN_LENGTH = 2;
export const PROJECT_KEY_MAX_LENGTH = 5;

export const projectNameSchema = workspaceNameSchema;

/** Two to five uppercase ASCII letters; unique per workspace. It prefixes card IDs (KB-12). */
export const projectKeySchema = z
  .string()
  .regex(
    new RegExp(`^[A-Z]{${PROJECT_KEY_MIN_LENGTH},${PROJECT_KEY_MAX_LENGTH}}$`),
    `Key must be ${PROJECT_KEY_MIN_LENGTH} to ${PROJECT_KEY_MAX_LENGTH} uppercase letters`,
  );

export const workspaceProjectsParamsSchema = z.strictObject({ wid: z.uuid() });
export const projectParamsSchema = z.strictObject({ pid: z.uuid() });

export const createProjectRequestSchema = z.strictObject({
  name: projectNameSchema,
  key: projectKeySchema,
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

/** The key is fixed after creation (card IDs are built from it); only the name can change. */
export const updateProjectRequestSchema = z.strictObject({ name: projectNameSchema });
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const projectSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  name: z.string(),
  key: z.string(),
  createdAt: z.iso.datetime(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectResponseSchema = z.object({ project: projectSchema });
export type ProjectResponse = z.infer<typeof projectResponseSchema>;

export const projectListResponseSchema = z.object({ projects: z.array(projectSchema) });
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;

/**
 * Suggests a key from a project name: the initials of up to five words ("Kanban Board" -> "KB"),
 * or the first three letters of a single word ("Kanban" -> "KAN"). May be shorter than the
 * minimum for very short names; the form validates it.
 */
export function suggestProjectKey(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .map((w) => w.replace(/[^A-Z]/g, ''))
    .filter((w) => w.length > 0);
  const [first] = words;
  if (!first) return '';
  if (words.length === 1) return first.slice(0, 3);
  return words
    .slice(0, PROJECT_KEY_MAX_LENGTH)
    .map((w) => w[0])
    .join('');
}
