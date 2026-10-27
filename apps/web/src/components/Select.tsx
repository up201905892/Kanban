import { useId } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { fieldIds } from './field';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'id' | 'children'
> {
  label: string;
  options: SelectOption[];
  hint?: string;
  error?: string;
  id?: string;
}

export function Select({ label, options, hint, error, id, ...props }: SelectProps) {
  const generated = useId();
  const selectId = id ?? generated;
  const { hintId, errorId, describedBy } = fieldIds(selectId, hint, error);
  return (
    <div className="field">
      <label htmlFor={selectId}>{label}</label>
      {hint && <p id={hintId}>{hint}</p>}
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
