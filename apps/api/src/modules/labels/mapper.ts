import type { Label, LabelColor } from '@kanban/shared';

export const toLabel = (row: {
  id: string;
  projectId: string;
  name: string;
  color: string;
}): Label => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  // The database CHECK keeps the column inside the palette.
  color: row.color as LabelColor,
});
