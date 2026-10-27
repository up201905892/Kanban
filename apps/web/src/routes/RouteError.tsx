import { useRouteError } from 'react-router';
import { Button } from '../components';

/** Error boundary for the route tree: shows a message and a "Reload" action. */
export function RouteError() {
  const error = useRouteError();
  if (error instanceof Error) console.error(error);
  return (
    <main role="alert">
      <h1>Something went wrong</h1>
      <p>An unexpected error occurred. Reloading the page usually fixes it.</p>
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </main>
  );
}
