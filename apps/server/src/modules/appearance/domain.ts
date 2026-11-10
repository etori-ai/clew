import { LOGO_MAX_BYTES, type LogoMediaType } from '@clew/contracts';
import type { LogoImage } from './ports';

/**
 * What an uploaded logo must be (D97). A PNG is recognised by its signature. An SVG is text a browser may run, so one
 * that could carry script, load something from elsewhere or embed foreign markup is refused whole rather than cleaned:
 * a municipality's mark exported from a drawing tool has none of it. The header draws the logo through `img`, where an
 * SVG cannot run script, and the route serves it under a sandboxing policy; this check is the third lock, not the only one.
 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const UNSAFE_SVG: ReadonlyArray<readonly [RegExp, string]> = [
  [/<\s*script/i, 'skript'],
  [/<\s*(foreignObject|iframe|embed|object|audio|video|handler|listener)/i, 'inbäddat innehåll'],
  [/<!\s*(ENTITY|DOCTYPE)/i, 'en dokumenttypsdeklaration'],
  [/\son[a-z]+\s*=/i, 'händelseattribut'],
  [/(javascript|vbscript)\s*:/i, 'skriptadresser'],
  [/@import/i, 'importerade stilmallar'],
  [/\b(?:xlink:)?href\s*=\s*["']?\s*(?!#|data:image\/(?:png|jpeg);base64,)[^"'\s>]/i, 'länkar ut ur bilden'],
  [/url\(\s*["']?\s*(?!#)[^)\s]/i, 'resurser utanför bilden'],
];
export type LogoProblem = { problem: string };

function bytesOf(base64: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  } catch {
    return null;
  }
}
/** The image an administrator sent, as it will be stored, or the Swedish reason it is refused. */
export function logoImageOf(input: { mediaType: LogoMediaType; data: string }, label: string): LogoImage | LogoProblem {
  const bytes = bytesOf(input.data);
  if (!bytes || !bytes.length) return { problem: `${label} går inte att läsa.` };
  if (bytes.length > LOGO_MAX_BYTES)
    return { problem: `${label} är för stor. Högst ${Math.round(LOGO_MAX_BYTES / 1000)} kB.` };
  if (input.mediaType === 'image/png') {
    if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte))
      return { problem: `${label} är inte en PNG-bild.` };
    return { mediaType: input.mediaType, bytes };
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { problem: `${label} är inte en SVG-bild i UTF-8.` };
  }
  if (!/<\s*svg[\s>]/i.test(text)) return { problem: `${label} är inte en SVG-bild.` };
  for (const [pattern, what] of UNSAFE_SVG)
    if (pattern.test(text)) return { problem: `${label} innehåller ${what}, vilket inte tillåts i en logotyp.` };
  return { mediaType: input.mediaType, bytes };
}
export const isLogoProblem = (value: LogoImage | LogoProblem): value is LogoProblem => 'problem' in value;
