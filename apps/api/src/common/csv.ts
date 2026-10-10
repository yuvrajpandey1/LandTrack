export function escapeCsvCell(value: unknown): string {
  const raw = value instanceof Date
    ? value.toISOString()
    : typeof value === 'object' && value !== null
      ? JSON.stringify(value)
      : String(value ?? '');
  const safe = typeof value === 'string' && /^[\t\r\n ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}
