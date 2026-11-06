/** Clew's own user records; identity and unit are always taken from the authenticated actor. */
export interface UserReads {
  capabilities(personId: string): Promise<string[]>;
  directory(unitId: string): Promise<Array<{ id: string; name: string; role: string }>>;
}
