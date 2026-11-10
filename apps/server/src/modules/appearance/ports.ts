import type { InstallationTheme, LogoMediaType } from '@clew/contracts';

/** One stored image of the logo: what the browser is served, byte for byte. */
export interface LogoImage {
  mediaType: LogoMediaType;
  bytes: Uint8Array;
}
export interface StoredLogo {
  alt: string;
  light: LogoImage;
  dark: LogoImage | null;
}
/**
 * The installation's appearance as stored (D98): one record for the whole installation. An installation nobody has
 * configured has no row and reads as revision 0 with no theme and no logo, which is Astryx Neutral.
 */
export interface AppearanceRecord {
  revision: number;
  theme: InstallationTheme | null;
  logo: StoredLogo | null;
  updatedAt: string | null;
  updatedBy: string | null;
}
export interface AppearanceAuditEntry {
  actor: string;
  action: string;
  subject: string;
  details: Record<string, unknown>;
}
export interface AppearanceTx {
  /** The record, held for the rest of the transaction so two saves run one after the other and a revision is never reused. */
  read(): Promise<AppearanceRecord>;
  write(record: AppearanceRecord): Promise<void>;
  audit(entry: AppearanceAuditEntry): Promise<void>;
}
export interface AppearanceStore {
  read(): Promise<AppearanceRecord>;
  transaction<T>(fn: (tx: AppearanceTx) => Promise<T>): Promise<T>;
}
export const EMPTY_APPEARANCE: AppearanceRecord = {
  revision: 0,
  theme: null,
  logo: null,
  updatedAt: null,
  updatedBy: null,
};
