import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
}) {
  return (
    <button
      className={`ds-button ds-button-${variant} ds-button-${size} ${className}`.trim()}
      {...props}
    />
  );
}
