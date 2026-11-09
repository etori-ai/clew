import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Theme } from '@astryxdesign/core/theme';
import { createClewTheme } from './theme';
import type { Branding } from './branding';

import { APPEARANCE_PREFERENCE_KEY as preferenceKey, type ColorMode } from './appearance-preference';

const AppearanceContext = createContext<{
  mode: ColorMode;
  isPersistent: boolean;
  setMode: (mode: ColorMode) => void;
} | null>(null);

/** Only the display preference is stored; identity and work data stay in the session and query cache. */
export function AppearanceProvider({ branding, children }: { branding: Branding; children: ReactNode }) {
  const theme = useMemo(() => createClewTheme(branding), [branding]);
  const [preference, setPreference] = useState<{ mode: ColorMode; isPersistent: boolean }>(() => {
    // Follows the computer until the person chooses: Astryx's own default, and what a person who set dark mode for their eyes expects (D39).
    try {
      const stored = localStorage.getItem(preferenceKey);
      return { mode: stored === 'dark' || stored === 'light' ? stored : 'system', isPersistent: true };
    } catch {
      return { mode: 'system', isPersistent: false };
    }
  });
  const setMode = (mode: ColorMode) => {
    let isPersistent = true;
    try {
      localStorage.setItem(preferenceKey, mode);
    } catch {
      isPersistent = false;
    }
    setPreference({ mode, isPersistent });
  };
  return (
    <AppearanceContext value={{ ...preference, setMode }}>
      <Theme theme={theme} mode={preference.mode}>
        {children}
      </Theme>
    </AppearanceContext>
  );
}

export function useAppearance() {
  const appearance = useContext(AppearanceContext);
  if (!appearance) throw new Error('AppearanceProvider is required.');
  return appearance;
}
