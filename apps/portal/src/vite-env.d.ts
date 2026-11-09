/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BRAND_PROFILE?: string;
  readonly VITE_BRAND_ACCENT?: string;
  readonly VITE_BRAND_ACCENT_MUTED?: string;
  readonly VITE_HEADER_LOGO_SRC?: string;
  readonly VITE_HEADER_LOGO_DARK_SRC?: string;
  readonly VITE_HEADER_LOGO_ALT?: string;
  /** The shared header's menu as the intranet serves it (D87); unset, the portal draws the fixture. */
  readonly VITE_SITE_MENU_SRC?: string;
}
