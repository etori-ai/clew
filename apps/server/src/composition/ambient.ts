/** The two ambient sources every use case takes through `deps` (D25): the wall clock and random ids. Only the composition root reads them. */
export const clock = () => new Date();
export const ids = () => crypto.randomUUID();
