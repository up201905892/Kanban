import { VELOCITY_SPRINT_LIMIT, averageCompleted, type VelocityResponse } from '@kanban/shared';
import type { PrismaClient } from '../../db.js';
import { authorize } from '../authz/index.js';

/**
 * Velocity of a project (any role): the last closed sprints with their committed and completed
 * points (stored when the sprint started and closed), oldest first, plus the average completed.
 */
export async function getVelocity(
  prisma: PrismaClient,
  user: { id: string },
  projectId: string,
): Promise<VelocityResponse> {
  await authorize(prisma, user, { type: 'project', id: projectId }, 'workspace:read');
  const rows = await prisma.sprint.findMany({
    where: { projectId, status: 'closed' },
    orderBy: [{ closedAt: 'desc' }, { id: 'desc' }],
    take: VELOCITY_SPRINT_LIMIT,
    select: { id: true, name: true, committedPoints: true, completedPoints: true },
  });
  const sprints = rows.reverse().map((r) => ({
    id: r.id,
    name: r.name,
    committedPoints: r.committedPoints ?? 0,
    completedPoints: r.completedPoints ?? 0,
  }));
  return { sprints, averageCompleted: averageCompleted(sprints) };
}
