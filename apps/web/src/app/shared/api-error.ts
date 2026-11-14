import { HttpErrorResponse } from '@angular/common/http';

/** Best-effort message from a Nest-style JSON error body. */
export function apiErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { message?: string | string[] } | string | null;
    const raw =
      typeof body === 'string'
        ? body
        : Array.isArray(body?.message)
          ? body.message.join(' ')
          : body?.message;
    if (typeof raw === 'string' && raw.trim()) {
      return raw;
    }
    if (err.status === 403) {
      return 'You do not have permission to do that.';
    }
    if (err.status === 409) {
      return 'That action conflicts with the current hold state.';
    }
    if (err.status === 404) {
      return 'Not found.';
    }
  }
  return fallback;
}
