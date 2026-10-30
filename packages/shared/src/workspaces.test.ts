import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_NAME_MAX_LENGTH,
  createWorkspaceRequestSchema,
  deleteWorkspaceRequestSchema,
  workspaceParamsSchema,
} from './workspaces.js';

describe('workspace schemas', () => {
  it('trims the name', () => {
    expect(createWorkspaceRequestSchema.parse({ name: '  Acme  ' }).name).toBe('Acme');
  });

  it('accepts a name at the length limit and rejects one over it', () => {
    expect(
      createWorkspaceRequestSchema.safeParse({ name: 'a'.repeat(WORKSPACE_NAME_MAX_LENGTH) })
        .success,
    ).toBe(true);
    expect(
      createWorkspaceRequestSchema.safeParse({ name: 'a'.repeat(WORKSPACE_NAME_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
  });

  it('rejects empty, blank, missing and unknown fields', () => {
    expect(createWorkspaceRequestSchema.safeParse({ name: '' }).success).toBe(false);
    expect(createWorkspaceRequestSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(createWorkspaceRequestSchema.safeParse({}).success).toBe(false);
    expect(createWorkspaceRequestSchema.safeParse({ name: 'A', role: 'owner' }).success).toBe(
      false,
    );
  });

  it('requires a confirmation name for delete and a UUID param', () => {
    expect(deleteWorkspaceRequestSchema.safeParse({}).success).toBe(false);
    expect(deleteWorkspaceRequestSchema.safeParse({ confirmName: 'Acme' }).success).toBe(true);
    expect(workspaceParamsSchema.safeParse({ id: 'nope' }).success).toBe(false);
  });
});
