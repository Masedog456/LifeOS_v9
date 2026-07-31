/**
 * Browser permissions inventory (LIFEOS-040, Feature 27).
 *
 * LifeOS uses a deliberately small set of browser capabilities. This lists them
 * (and, importantly, the ones we do NOT use) so the Privacy Center can be
 * explicit. The Permissions-Policy header (lib/security/headers.ts) disables
 * camera, microphone, and geolocation outright.
 */

export interface BrowserPermission {
  name: string;
  used: boolean;
  why: string;
}

export const BROWSER_PERMISSIONS: readonly BrowserPermission[] = [
  { name: "Local storage", used: true, why: "Stores your data locally (local-first) so LifeOS works offline." },
  { name: "Downloads", used: true, why: "Saves exports and backups you explicitly request." },
  { name: "Clipboard write", used: true, why: "Copies a sanitized diagnostic report when you ask." },
  { name: "Network (same-origin + your Supabase)", used: true, why: "Syncs your data when signed in." },
  { name: "Camera", used: false, why: "Not used. Disabled by Permissions-Policy." },
  { name: "Microphone", used: false, why: "Not used. Disabled by Permissions-Policy." },
  { name: "Geolocation", used: false, why: "Not used. Disabled by Permissions-Policy." },
  { name: "Notifications", used: false, why: "Not used. LifeOS sends no notifications." },
];

export function usedPermissions(): BrowserPermission[] {
  return BROWSER_PERMISSIONS.filter((p) => p.used);
}
export function unusedPermissions(): BrowserPermission[] {
  return BROWSER_PERMISSIONS.filter((p) => !p.used);
}
