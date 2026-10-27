export interface SpinnerProps {
  /** Accessible label announced to screen readers. */
  label?: string;
}

export function Spinner({ label = 'Loading' }: SpinnerProps) {
  return (
    <span role="status" className="spinner">
      <span aria-hidden="true" className="spinner-dot" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
