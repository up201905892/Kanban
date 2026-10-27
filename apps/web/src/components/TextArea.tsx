import { useId } from 'react';
import type { TextareaHTMLAttributes } from 'react';
import { fieldIds } from './field';

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
  id?: string;
}

export function TextArea({ label, hint, error, id, ...props }: TextAreaProps) {
  const generated = useId();
  const inputId = id ?? generated;
  const { hintId, errorId, describedBy } = fieldIds(inputId, hint, error);
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      {hint && <p id={hintId}>{hint}</p>}
      <textarea
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
