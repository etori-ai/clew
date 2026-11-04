import type { AnswerShape, SearchResult, SourceCitation } from '@clew/contracts';

/**
 * What the model writes is plain text with two conventions the prompt asks for (D26): numbered steps when the source is
 * a procedure, and one last line "Följdfrågor: a | b | c". Both are read here in code, so a weak open-weight model that
 * cannot do structured output still gets the same treatment, and the person never sees the trailer.
 */
const TRAILER = /^\s*följdfrågor\s*:\s*(.*)$/i;
const STEP = /^\d{1,2}[.)]\s+\S/;
export const FOLLOW_UP_LIMIT = 3;
export interface ParsedAnswer { body: string; followUps: string[]; shape?: Extract<AnswerShape, 'steg'> }
export function parseAnswer(text: string): ParsedAnswer {
  const lines = text.trim().split('\n');
  let followUps: string[] = [];
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 2; i--) {
    const m = TRAILER.exec(lines[i]!);
    if (m) { followUps = m[1]!.split('|').map(s => s.trim().replace(/[?]*$/, '?')).filter(s => s.length > 1).slice(0, FOLLOW_UP_LIMIT); lines.splice(i); break; }
  }
  const body = lines.join('\n').trim();
  const steps = body.split('\n').map(l => l.trim()).filter(Boolean).filter(l => STEP.test(l)).length;
  return { body, followUps, ...(steps >= 2 ? { shape: 'steg' } : {}) };
}
/** The hits the model read, numbered as the model saw them, so `[n]` in the answer points at a source the person can open or chip. */
export function citationsOf(result: Pick<SearchResult, 'rows'>): SourceCitation[] {
  return result.rows.slice(0, 10).map((r, i) => ({
    n: i + 1, ref: `document:${r.connector}:${r.ref}`, label: r.label, source: r.source, stale: r.stale,
    ...(r.link ? { link: r.link } : {}), ...(r.section ? { section: r.section } : {}), ...(r.owner ? { owner: r.owner } : {}), ...(r.reviewedAt ?? r.updatedAt ? { reviewedAt: (r.reviewedAt ?? r.updatedAt)! } : {}),
  }));
}
