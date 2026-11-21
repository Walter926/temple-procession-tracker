type Failure = { code?: unknown; message?: unknown; details?: { errors?: unknown } };
export function managementError(reason: unknown, endpoint?: string): string {
  const failure: Failure = reason && typeof reason === 'object' ? reason : {};
  const code = String(failure.code ?? '').replace(/^functions\//, '');
  const message = typeof failure.message === 'string' ? failure.message.trim() : '';
  const errors = failure.details?.errors;
  if (Array.isArray(errors) && errors.some(value => typeof value === 'string' && value.trim())) {
    return [...new Set(errors.filter((value): value is string => typeof value === 'string' && !!value.trim()))].join(' ');
  }
  if (endpoint && ['internal', 'unavailable', 'not-found', 'unknown'].includes(code)) {
    return `${endpoint} could not complete. Check your connection, then retry. If it persists, ask an administrator to verify this callable is deployed in the configured region and inspect its function logs. No successful result was confirmed.`;
  }
  if (['internal', 'unknown'].includes(code) || /^(internal|unknown)(\s*\[0\])?$/i.test(message)) {
    return 'The server could not complete this request. Retry; if it persists, ask an administrator to check the function deployment and logs. No successful result was confirmed.';
  }
  if (code === 'unauthenticated') return 'Your session has expired. Sign in again and retry.';
  if (code === 'already-exists' && endpoint === 'manageEvent') return 'A record already exists for this save ID. Reload the list to confirm the saved record before editing; do not create another copy.';
  if (code === 'permission-denied') return message && !/^permission[- ]denied$/i.test(message) ? message : 'Your account cannot perform this action. Ask an administrator to check your role and event access.';
  return message || 'The request failed. Check your connection and try again.';
}
