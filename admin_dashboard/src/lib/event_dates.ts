export function parseLocalDateTime(value: string): number {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!parts) return NaN;
  const date = new Date(value), [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== (second || 0)) return NaN;
  return date.getTime();
}

export function dateTimeLocal(time?: { toDate: () => Date } | null): string {
  if (!time) return '';
  const date = time.toDate();
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
}

export function overdueEventNotice(event: { status: string; endTime?: { toMillis: () => number } | null }, now: number): string {
  const end = event.endTime?.toMillis();
  return ['active', 'scheduled'].includes(event.status) && Number.isFinite(end) && end! < now
    ? 'Past planned end time. Status is managed manually; an organizer must review and update it.' : '';
}
