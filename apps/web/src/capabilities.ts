import { createContext, useContext } from 'react';
import { isCapability, relationGrantsOf, type Capability, type RelationGrant } from '@clew/contracts';

/**
 * The administration capabilities the signed-in person holds (D85), as the session answers them: which rows under
 * Administration the rail draws. Only what the browser shows; the server checks every admin call again (D23).
 */
export const HeldCapabilities = createContext<readonly Capability[]>([]);
export const useHeldCapabilities = () => useContext(HeldCapabilities);
/** The session's `capabilities`, keeping only names Clew knows. */
export const capabilitiesOf = (value: unknown): Capability[] =>
  Array.isArray(value) ? value.filter((c): c is Capability => typeof c === 'string' && isCapability(c)) : [];
/**
 * The relations to people the signed-in person holds by grant (D121), as the session answers them: whether the
 * Kompetens place offers its search. Never a capability (D118), so never an Administration row; every read is checked
 * again on the server.
 */
export const HeldRelations = createContext<readonly RelationGrant[]>([]);
export const useHeldRelations = () => useContext(HeldRelations);
/** The session's `relations`, keeping only names Clew knows. */
export const relationsOf = (value: unknown): RelationGrant[] =>
  Array.isArray(value) ? relationGrantsOf(value.filter((r): r is string => typeof r === 'string')) : [];
