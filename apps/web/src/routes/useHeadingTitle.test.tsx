import { act, render } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useHeadingTitle } from './useHeadingTitle';

function Harness() {
  const ref = useRef<HTMLElement>(null);
  const [name, setName] = useState<string | null>(null);
  useHeadingTitle(ref);
  return (
    <main ref={ref}>
      {name && <h1>{name}</h1>}
      <button onClick={() => setName('Members')}>load</button>
    </main>
  );
}

describe('useHeadingTitle', () => {
  it('follows the h1 as it appears and changes, and falls back to the app name', async () => {
    const { getByRole } = render(<Harness />);
    expect(document.title).toBe('Kanban');
    await act(async () => {
      getByRole('button').click();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(document.title).toBe('Members - Kanban'));
  });
});
