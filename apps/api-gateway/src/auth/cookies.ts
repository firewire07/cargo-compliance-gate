export const AUTH_COOKIE = 'ccg_token';

export function parseCookies(header?: string): Record<string, string> {
  if (!header) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) {
      continue;
    }
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) {
      out[key] = decodeURIComponent(value);
    }
  }
  return out;
}

export function authCookieHeader(token: string, maxAgeSec: number): string {
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSec}`;
}
