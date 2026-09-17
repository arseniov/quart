export interface ImpersonationContext {
  adminId: string;
  targetUserId: string;
  expiresAt: number;
}

export function parseImpersonationHeader(value: string | string[] | undefined): ImpersonationContext | null {
  if (!value || Array.isArray(value)) return null;
  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== 'super-admin') return null;
  const [, adminId, targetUserId, expiresRaw] = parts as [string, string, string, string];
  return { adminId, targetUserId, expiresAt: Number(expiresRaw) };
}
