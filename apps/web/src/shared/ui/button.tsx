import type { ButtonHTMLAttributes } from 'react';

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'text';
}) {
  return <button className={`${variant} ${className}`.trim()} {...props} />;
}
