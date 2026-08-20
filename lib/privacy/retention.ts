/**
 * Retention policy (LIFEOS-040, Feature 16 + DB).
 *
 * Documents, in code, how long each added retention table keeps data and what
 * happens on account deletion. Honest by design: we do NOT claim instant erasure
 * where infrastructure (Postgres backups, provider retention) cannot guarantee
 * it. The Privacy Center and account-deletion flow render these statements.
 */

export interface RetentionRule {
  subject: string;
  retention: string;
  onAccountDeletion: string;
}

export const RETENTION_RULES: readonly RetentionRule[] = [
  { subject: "User records (all domains)", retention: "Kept until you delete them or your account.", onAccountDeletion: "Deleted immediately from the primary database via user-ownership cascade." },
  { subject: "sanitized_error_events", retention: "Rolling 30 days, capped per user; contains no record contents.", onAccountDeletion: "Deleted with the account (cascade)." },
  { subject: "export_history", retention: "Metadata only (timestamp, counts, checksum) — no archive contents. Kept 1 year.", onAccountDeletion: "Deleted with the account (cascade)." },
  { subject: "import_history", retention: "Metadata only (timestamp, mode, counts). Kept 1 year.", onAccountDeletion: "Deleted with the account (cascade)." },
  { subject: "account_deletion_requests", retention: "Kept as an audit record of the deletion request itself.", onAccountDeletion: "Marked complete; retained as a minimal security log (no content)." },
  { subject: "Database backups", retention: "The hosting provider (Supabase/Postgres) may retain point-in-time backups per its policy.", onAccountDeletion: "Purged as those backups roll off; we cannot guarantee instant removal from backups." },
  // LIFEOS-058A: this used to read "until you clear it or sign out", which was
  // not true. Conqify is local-first — signing out detaches remote sync and
  // deliberately KEEPS local records, so the app still works signed out. Saying
  // otherwise invited people to treat sign-out as a wipe on a shared machine.
  { subject: "Local device data", retention: "Stays on your device until you reset local data or delete your account. Signing out keeps it, so the app still works offline.", onAccountDeletion: "Cleared on this device at deletion; other devices clear on next sign-in." },
  // The one deliberate exception, and why it is one: an unfinished Constitution
  // Builder interview holds answers about faith, health, money and family that
  // the user has not yet chosen to keep. It is scaffolding, not a record, so it
  // does not get the local-first treatment above. Anything they DID adopt, keep
  // as a draft, or save as a Note is an ordinary record and is covered by the
  // row above.
  { subject: "In-progress Constitution Builder interview", retention: "Stays in this browser only — never synced, exported or backed up. Deleted when you discard or finish the interview, sign out, or reset local data.", onAccountDeletion: "Removed with local data on this device; it was never sent anywhere else." },
];

/** The honest disclosure shown during account deletion. */
export function deletionDisclosure(): string[] {
  return [
    "Your records are deleted from the primary database immediately.",
    "Deletion markers (tombstones) propagate so other devices remove the data on next sign-in.",
    "A minimal security log of the deletion request is retained (no record contents).",
    "Database backups kept by the hosting provider are purged as they roll off; we cannot guarantee instant removal from backups.",
  ];
}
