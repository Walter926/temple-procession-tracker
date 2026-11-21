export default function FieldError({ name, errors }: { name: string; errors: Record<string, string> }) {
  return errors[name] ? <span id={`${name}-error`} className="error" role="alert">{errors[name]}</span> : null;
}
