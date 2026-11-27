import { z } from 'zod';

/** How many closed sprints the velocity report covers. */
export const VELOCITY_SPRINT_LIMIT = 6;

export const velocitySprintSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  committedPoints: z.number().int().nonnegative(),
  completedPoints: z.number().int().nonnegative(),
});
export type VelocitySprint = z.infer<typeof velocitySprintSchema>;

/** `GET /api/projects/:pid/velocity`: the last closed sprints, oldest first. */
export const velocityResponseSchema = z.object({
  sprints: z.array(velocitySprintSchema).max(VELOCITY_SPRINT_LIMIT),
  /** Average completed points of the listed sprints, one decimal; 0 when there are none. */
  averageCompleted: z.number().nonnegative(),
});
export type VelocityResponse = z.infer<typeof velocityResponseSchema>;

/** Average completed points, rounded to one decimal; 0 for an empty list. */
export function averageCompleted(sprints: readonly { completedPoints: number }[]): number {
  if (sprints.length === 0) return 0;
  const total = sprints.reduce((sum, s) => sum + s.completedPoints, 0);
  return Math.round((total / sprints.length) * 10) / 10;
}

/** Text alternative of the chart (the chart is never alone). */
export function velocitySummary(data: VelocityResponse): string {
  const n = data.sprints.length;
  if (n === 0) return 'No closed sprints yet';
  return `Average velocity: ${data.averageCompleted} ${data.averageCompleted === 1 ? 'point' : 'points'} completed per sprint over the last ${n} ${n === 1 ? 'sprint' : 'sprints'}`;
}
