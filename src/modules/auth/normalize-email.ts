// Single normalization rule shared by the DTOs (so validation sees the
// cleaned value) and AuthService (so service-level callers and tests get
// the same behavior without going through the HTTP pipe).
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
