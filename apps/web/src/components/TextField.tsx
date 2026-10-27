import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';
import { fieldIds } from './field';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
  id?: string;
}

export function TextField({ label, hint, error, id, ...props }: TextFieldProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const { hintId, errorId, describedBy } = fieldIds(inputId, hint, error);
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      {hint && <p id={hintId}>{hint}</p>}
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
