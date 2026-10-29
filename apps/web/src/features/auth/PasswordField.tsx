import { useId, useState } from 'react';
import type { InputHTMLAttributes, Ref } from 'react';
import { fieldIds } from '../../components/field';

export interface PasswordFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'type'
> {
  label: string;
  hint?: string;
  error?: string;
  inputRef?: Ref<HTMLInputElement>;
}

/** Password input with a show/hide toggle button (`aria-pressed`). */
export function PasswordField({ label, hint, error, inputRef, ...props }: PasswordFieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const { hintId, errorId, describedBy } = fieldIds(id, hint, error);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <p id={hintId}>{hint}</p>}
      <div className="password-row">
        <input
          id={id}
          ref={inputRef}
          type={visible ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...props}
        />
        <button type="button" aria-pressed={visible} onClick={() => setVisible((v) => !v)}>
          Show password
        </button>
      </div>
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
