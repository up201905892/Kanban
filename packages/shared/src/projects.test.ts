import { describe, expect, it } from 'vitest';
import {
  createProjectRequestSchema,
  projectKeySchema,
  suggestProjectKey,
  updateProjectRequestSchema,
} from './projects.js';

describe('suggestProjectKey', () => {
  it.each([
    ['Kanban Board', 'KB'],
    ['Kanban', 'KAN'],
    ['  my  great new project  ', 'MGNP'],
    ['one two three four five six seven', 'OTTFF'],
    ['Água Pura', 'AP'],
    ['Go', 'GO'],
    ['', ''],
    ['123 456', ''],
  ])('%j -> %j', (name, key) => {
    expect(suggestProjectKey(name)).toBe(key);
  });

  it('suggests a valid key for a typical name', () => {
    expect(projectKeySchema.safeParse(suggestProjectKey('Kanban Board')).success).toBe(true);
  });
});

describe('project schemas', () => {
  it.each(['KB', 'ABCDE'])('accepts key %s', (key) => {
    expect(projectKeySchema.safeParse(key).success).toBe(true);
  });
  it.each(['K', 'ABCDEF', 'kb', 'K1', 'K B', '', 'ÁB'])('rejects key %j', (key) => {
    expect(projectKeySchema.safeParse(key).success).toBe(false);
  });
  it('trims names and bounds them to 1-80 characters', () => {
    expect(createProjectRequestSchema.parse({ name: ' Web ', key: 'WEB' }).name).toBe('Web');
    expect(createProjectRequestSchema.safeParse({ name: '', key: 'WEB' }).success).toBe(false);
    expect(createProjectRequestSchema.safeParse({ name: 'a'.repeat(81), key: 'WEB' }).success).toBe(
      false,
    );
  });
  it('does not allow changing the key or sending unknown fields', () => {
    expect(updateProjectRequestSchema.safeParse({ name: 'X', key: 'ABC' }).success).toBe(false);
  });
});
