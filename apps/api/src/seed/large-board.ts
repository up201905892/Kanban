import { keysBetween } from '@kanban/shared';
import type { PrismaClient } from '../db.js';
import { hashPassword } from '../modules/auth/password.js';

export const SEED_EMAIL = 'large-board@example.com';
/** Local development only (the seed refuses to run in production); not a real secret. */
export const SEED_PASSWORD = 'large-board-demo-1234';
const COLUMN_NAMES = ['Backlog', 'To do', 'In progress', 'Review', 'Done'] as const;
const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;

export interface LargeBoardSeed {
  userId: string;
  workspaceId: string;
  projectId: string;
  boardId: string;
  columnIds: string[];
  cardCount: number;
}

/**
 * Creates a user, a workspace and a project whose board has 5 columns and `cardCount` cards with
 * every field filled (assignee, priority, estimate, description). Cards are spread evenly.
 * `suffix` keeps repeated runs apart (the project key and the user email carry it).
 */
export async function seedLargeBoard(
  prisma: PrismaClient,
  options: { cardCount?: number; suffix?: string } = {},
): Promise<LargeBoardSeed> {
  const cardCount = options.cardCount ?? 600;
  const suffix = options.suffix ?? '';
  const email = suffix ? SEED_EMAIL.replace('@', `-${suffix}@`) : SEED_EMAIL;
  const user =
    (await prisma.user.findUnique({ where: { email } })) ??
    (await prisma.user.create({
      data: { email, name: 'Large Board', passwordHash: await hashPassword(SEED_PASSWORD) },
    }));
  const workspace = await prisma.workspace.create({
    data: {
      name: 'Large board workspace',
      memberships: { create: { userId: user.id, role: 'owner' } },
    },
  });
  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      name: 'Large board',
      key: 'BIG',
      nextCardNumber: cardCount + 1,
    },
  });
  const board = await prisma.board.create({ data: { projectId: project.id } });
  const columnKeys = keysBetween(null, null, COLUMN_NAMES.length);
  const columns = await Promise.all(
    COLUMN_NAMES.map((name, index) =>
      prisma.column.create({
        data: {
          boardId: board.id,
          name,
          position: columnKeys[index] as string,
          isDone: index === COLUMN_NAMES.length - 1,
        },
      }),
    ),
  );

  const perColumn = Math.ceil(cardCount / columns.length);
  const cards = [];
  for (const [columnIndex, column] of columns.entries()) {
    const first = columnIndex * perColumn;
    const count = Math.max(0, Math.min(perColumn, cardCount - first));
    const keys = keysBetween(null, null, Math.max(count, 1));
    for (let i = 0; i < count; i++) {
      const number = first + i + 1;
      cards.push({
        boardId: board.id,
        columnId: column.id,
        number,
        title: `Seeded card ${number}`,
        description: `Description of seeded card ${number}.`,
        position: keys[i] as string,
        createdById: user.id,
        assigneeId: user.id,
        priority: PRIORITIES[number % PRIORITIES.length] as (typeof PRIORITIES)[number],
        estimate: number % 13,
      });
    }
  }
  await prisma.card.createMany({ data: cards });
  return {
    userId: user.id,
    workspaceId: workspace.id,
    projectId: project.id,
    boardId: board.id,
    columnIds: columns.map((c) => c.id),
    cardCount,
  };
}
