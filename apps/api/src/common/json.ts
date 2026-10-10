import { Prisma } from '@prisma/client';

export function toJsonInput(value: unknown): Prisma.InputJsonValue {
  if (value === null) throw new TypeError('A top-level JSON null is not supported.');
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((item) => item === null ? null : toJsonInput(item));
  }
  if (typeof value === 'object') {
    const entries: Array<[string, Prisma.InputJsonValue | null]> = [];
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) entries.push([key, item === null ? null : toJsonInput(item)]);
    }
    return Object.fromEntries(entries);
  }
  throw new TypeError('Value cannot be represented as JSON.');
}
