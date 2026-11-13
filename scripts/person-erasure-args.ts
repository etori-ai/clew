/** The operator's one-person erasures accept one exact id and an optional confirmation, each given once. */
export function parsePersonErasureArgs(args: readonly string[]): { personId: string; confirmed: boolean } | undefined {
  let personId: string | undefined;
  let confirmed = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--confirm' && !confirmed) confirmed = true;
    else if (arg === '--person' && personId === undefined) {
      personId = args[++i];
      if (!personId || personId.startsWith('--')) return undefined;
    } else return undefined;
  }
  return personId ? { personId, confirmed } : undefined;
}
