export const MFA_ENFORCED_ROLES = [
  'municipality_officer',
  'police_officer',
  'sanitation_officer',
  'moderator',
  'quart_admin',
  'super_admin',
] as const;

export type MfaEnforcedRole = (typeof MFA_ENFORCED_ROLES)[number];