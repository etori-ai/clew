import type { Capability } from '@clew/contracts';

/**
 * The development stack's directory: what a municipality's source (Metakatalogen in Sundsvall, D68) knows about the
 * people the stack signs in as. A person has a department and a manager flag, the two facts the provisioner turns into
 * D68's `unit:` and `unit-manager:` groups, plus the Clew capabilities that become `capability:` groups (D85).
 * Nothing in Clew reads this file; the provisioner does, and `scripts/auth-setup.ts` for the Keycloak accounts.
 */
export interface DirectoryUnit {
  id: string;
  label: string;
}
export interface DirectoryPerson {
  /** The source's stable id, never reused. `dev:` marks the development stack's people. */
  externalId: string;
  /** What a login is matched on; the Keycloak username in development. */
  userName: string;
  givenName: string;
  familyName: string;
  email: string;
  department: string;
  manager: boolean;
  capabilities: Capability[];
}
export interface Directory {
  units: DirectoryUnit[];
  people: DirectoryPerson[];
}
export const developmentDirectory: Directory = {
  units: [
    { id: 'unit-skola', label: 'Bergsåkers skola' },
    { id: 'unit-omsorg', label: 'Hemtjänst Centrum' },
    { id: 'unit-it', label: 'IT och digitalisering' },
  ],
  people: [
    // Hillevi is the manager persona (rektor); Hassan the employee persona (undersköterska, mobile).
    {
      externalId: 'dev:hillevi',
      userName: 'hillevi',
      givenName: 'Hillevi',
      familyName: 'Berg',
      email: 'hillevi@clew.test',
      department: 'unit-skola',
      manager: true,
      capabilities: [],
    },
    {
      externalId: 'dev:hassan',
      userName: 'hassan',
      givenName: 'Hassan',
      familyName: 'Ali',
      email: 'hassan@clew.test',
      department: 'unit-omsorg',
      manager: false,
      capabilities: [],
    },
    // Mikael is the systemförvaltare persona: administration is a capability, not a work role (D23, D85).
    {
      externalId: 'dev:mikael',
      userName: 'mikael',
      givenName: 'Mikael',
      familyName: 'Lund',
      email: 'mikael@clew.test',
      department: 'unit-it',
      manager: false,
      capabilities: ['admin.connectors', 'admin.users'],
    },
  ],
};
export const fullName = (p: DirectoryPerson) => `${p.givenName} ${p.familyName}`;
