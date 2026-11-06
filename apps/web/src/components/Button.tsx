import type { ButtonHTMLAttributes, Ref } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Forwarded to the button (React 19 passes `ref` as a regular prop). */
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ type = 'button', ...props }: ButtonProps) {
  return <button type={type} {...props} />;
}
