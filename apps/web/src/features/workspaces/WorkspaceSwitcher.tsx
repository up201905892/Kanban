import { useMatch, useNavigate } from 'react-router';
import { Select } from '../../components';
import { useWorkspaces } from './api';

/** Header control to jump between my workspaces (a native select: Tab, arrows, Enter). */
export function WorkspaceSwitcher() {
  const { data: workspaces } = useWorkspaces();
  const match = useMatch('/workspaces/:id/*');
  const navigate = useNavigate();

  if (!workspaces || workspaces.length === 0) return null;

  const current = match?.params['id'] ?? '';
  const options = [
    ...(workspaces.some((w) => w.id === current)
      ? []
      : [{ value: '', label: 'Choose a workspace' }]),
    ...workspaces.map((w) => ({ value: w.id, label: w.name })),
  ];

  return (
    <Select
      label="Workspace"
      options={options}
      value={workspaces.some((w) => w.id === current) ? current : ''}
      onChange={(event) => {
        if (event.target.value) void navigate(`/workspaces/${event.target.value}`);
      }}
    />
  );
}
