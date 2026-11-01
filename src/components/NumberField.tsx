import { useEffect, useState, type InputHTMLAttributes } from 'react';

/** Keep editing text until blur; an empty numeric field must stay empty. */
export default function NumberField({
  value,
  onValue,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onValue: (value: number) => void;
}) {
  const [text, setText] = useState(() => (Number.isFinite(value) ? String(value) : ''));
  useEffect(() => {
    setText((prior) =>
      (prior !== '' && Number(prior) === value) || (prior === '' && !Number.isFinite(value))
        ? prior
        : Number.isFinite(value)
          ? String(value)
          : '',
    );
  }, [value]);
  return (
    <input
      {...props}
      type="number"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onValue(event.target.value === '' ? NaN : event.target.valueAsNumber);
      }}
      onBlur={(event) => {
        if (event.target.value !== '' && Number.isFinite(event.target.valueAsNumber))
          setText(String(event.target.valueAsNumber));
        props.onBlur?.(event);
      }}
    />
  );
}
