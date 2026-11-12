import { createContext, useContext } from 'react';
import { isCapability, type Capability } from '@clew/contracts';

/**
 * The administration capabilities the signed-in person holds (D85), as the session answers them: which rows under
 * Administration the rail draws. Only what the browser shows; the server checks every admin call again (D23).
 */
export const HeldCapabilities = createContext<readonly Capability[]>([]);
export const useHeldCapabilities = () => useContext(HeldCapabilities);
/** The session's `capabilities`, keeping only names Clew knows. */
export const capabilitiesOf = (value: unknown): Capability[] =>
  Array.isArray(value) ? value.filter((c): c is Capability => typeof c === 'string' && isCapability(c)) : [];
