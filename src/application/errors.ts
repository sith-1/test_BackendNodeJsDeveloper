export class BadRequestError extends Error {}
export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class InternalError extends Error {}

export function isUniqueViolation(err: unknown): boolean {
  // Adapter should map driver errors if needed; here leave a simple duck-typing hook
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as { code?: string; name?: string };
  return anyErr.code === '23505' || anyErr.name === 'UniqueConstraintViolationError';
}

