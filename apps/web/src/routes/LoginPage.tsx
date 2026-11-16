import { loginRequestSchema } from '@kanban/shared';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Button, Spinner, TextField } from '../components';
import { useCurrentUser, useLogin } from '../features/auth/api';
import { failureFromError, fieldErrorsFromZod } from '../features/auth/form-errors';
import { PasswordField } from '../features/auth/PasswordField';
import { sanitizeNext } from '../features/auth/safe-next';
import { getSessionNotice, setSessionNotice } from '../features/auth/session-notice';
import { useAuthForm } from '../features/auth/useAuthForm';

const FIELDS = ['email', 'password'] as const;

export function LoginPage() {
  const [params] = useSearchParams();
  const next = sanitizeNext(params.get('next'));
  const navigate = useNavigate();
  // Set by the board when the session expired while offline (KB-021); shown as plain text.
  const [notice] = useState(getSessionNotice);
  useEffect(() => () => setSessionNotice(null), []);
  const { data: user } = useCurrentUser();
  const login = useLogin();
  const { failure, fail, clear, registerField } = useAuthForm(FIELDS);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (user) return <Navigate to={next} replace />;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    clear();
    const parsed = loginRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      fail({ fields: fieldErrorsFromZod(parsed.error, FIELDS) });
      return;
    }
    login.mutate(parsed.data, {
      onSuccess: () => {
        setSessionNotice(null);
        void navigate(next, { replace: true });
      },
      onError: (error) => fail(failureFromError(error, FIELDS)),
    });
  }

  const signupLink = next === '/' ? '/signup' : `/signup?next=${encodeURIComponent(next)}`;

  return (
    <>
      <h1>Log in</h1>
      {notice && (
        <p className="form-error" data-testid="login-notice">
          {notice}
        </p>
      )}
      <form onSubmit={onSubmit} noValidate aria-label="Log in">
        <TextField
          ref={registerField('email')}
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          {...(failure.fields.email && { error: failure.fields.email })}
        />
        <PasswordField
          inputRef={registerField('password')}
          label="Password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          {...(failure.fields.password && { error: failure.fields.password })}
        />
        {failure.form && <p className="form-error">{failure.form}</p>}
        <Button type="submit" disabled={login.isPending}>
          Log in
        </Button>
        {login.isPending && <Spinner label="Logging in" />}
      </form>
      <p>
        No account yet? <Link to={signupLink}>Sign up</Link>
      </p>
    </>
  );
}
