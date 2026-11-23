import { Button } from './Button';

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  /** Label of the retry action (the error boundary uses "Reload"). */
  retryLabel?: string;
  /** `1` when the error replaces the whole page, so the page still has its single `h1`. */
  headingLevel?: 1 | 2;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  retryLabel = 'Retry',
  headingLevel = 2,
}: ErrorStateProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <section className="state" role="alert">
      <Heading>{title}</Heading>
      <p>{message}</p>
      {onRetry && <Button onClick={onRetry}>{retryLabel}</Button>}
    </section>
  );
}
