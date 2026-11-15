import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  helperText,
  error,
  id,
  className = '',
  ...props
}) => {
  const inputId = id || props.name;

  return (
    <div className="form-group">
      {label && (
        <label htmlFor={inputId} className="form-label">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`input-control ${error ? 'input-error' : ''} ${className}`.trim()}
        {...props}
      />
      {error ? (
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger)' }}>
          {error}
        </span>
      ) : helperText ? (
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-light)' }}>
          {helperText}
        </span>
      ) : null}
    </div>
  );
};
