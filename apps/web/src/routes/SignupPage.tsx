import { PASSWORD_MIN_LENGTH, signupRequestSchema } from '@kanban/shared';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Button, Spinner, TextField } from '../components';
import { useCurrentUser, useSignup } from '../features/auth/api';
import { failureFromError, fieldErrorsFromZod } from '../features/auth/form-errors';
import { PasswordField } from '../features/auth/PasswordField';
import { sanitizeNext } from '../features/auth/safe-next';
import { useAuthForm } from '../features/auth/useAuthForm';

const FIELDS = ['name', 'email', 'password'] as const;

export function SignupPage() {
  const [params] = useSearchParams();
  const next = sanitizeNext(params.get('next'));
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();
  const signup = useSignup();
  const { failure, fail, clear, registerField } = useAuthForm(FIELDS);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (user) return <Navigate to={next} replace />;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    clear();
    const parsed = signupRequestSchema.safeParse({ name, email, password });
    if (!parsed.success) {
      fail({ fields: fieldErrorsFromZod(parsed.error, FIELDS) });
      return;
    }
    signup.mutate(parsed.data, {
      onSuccess: () => void navigate(next, { replace: true }),
      onError: (error) => fail(failureFromError(error, FIELDS, 'email')),
    });
  }

  const loginLink = next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;

  return (
    <>
      <h1>Sign up</h1>
      <form onSubmit={onSubmit} noValidate aria-label="Sign up">
        <TextField
          ref={registerField('name')}
          label="Name"
          name="name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          {...(failure.fields.name && { error: failure.fields.name })}
        />
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
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          {...(failure.fields.password && { error: failure.fields.password })}
        />
        {failure.form && <p className="form-error">{failure.form}</p>}
        <Button type="submit" disabled={signup.isPending}>
          Create account
        </Button>
        {signup.isPending && <Spinner label="Creating account" />}
      </form>
      <p>
        Already have an account? <Link to={loginLink}>Log in</Link>
      </p>
    </>
  );
}
