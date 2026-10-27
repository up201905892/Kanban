import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { AnnouncerProvider, Button, Dialog, Select, TextArea, TextField, useAnnounce } from '.';

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Edit card">
        <Button>First</Button>
        <Button>Last</Button>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('traps focus, closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Edit card' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('form fields', () => {
  it('TextField links its error and hint with aria-describedby', () => {
    render(<TextField label="Email" hint="Work address" error="Email is required" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Work address Email is required');
  });

  it('TextField has no description when valid', () => {
    render(<TextField label="Name" />);
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-describedby');
  });

  it('TextArea and Select link their errors too', () => {
    render(
      <>
        <TextArea label="Notes" error="Too long" />
        <Select label="Role" options={[{ value: 'a', label: 'A' }]} error="Pick one" />
      </>,
    );
    expect(screen.getByLabelText('Notes')).toHaveAccessibleDescription('Too long');
    expect(screen.getByLabelText('Role')).toHaveAccessibleDescription('Pick one');
  });
});

function Announcing() {
  const announce = useAnnounce();
  return (
    <>
      <Button onClick={() => announce('Saved')}>Save</Button>
      <Button onClick={() => announce('Failed to save', 'assertive')}>Fail</Button>
    </>
  );
}

describe('useAnnounce', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('writes polite messages to the polite region and errors to the assertive one', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AnnouncerProvider>
        <Announcing />
      </AnnouncerProvider>,
    );
    const polite = screen.getByTestId('live-polite');
    const assertive = screen.getByTestId('live-assertive');
    expect(polite).toHaveAttribute('aria-live', 'polite');
    expect(assertive).toHaveAttribute('aria-live', 'assertive');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(polite).toHaveTextContent('Saved');
    expect(assertive).toBeEmptyDOMElement();

    await user.click(screen.getByRole('button', { name: 'Fail' }));
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(assertive).toHaveTextContent('Failed to save');
  });

  it('throws outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Announcing />)).toThrow(/AnnouncerProvider/);
    vi.restoreAllMocks();
  });
});
