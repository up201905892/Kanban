import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required accessible name (icon-only buttons have no visible text). */
  label: string;
  icon: ReactNode;
}

export function IconButton({ label, icon, type = 'button', ...props }: IconButtonProps) {
  return (
    <button type={type} aria-label={label} title={label} {...props}>
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}
