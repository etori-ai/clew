import { LOGO_MAX_BYTES, type LogoMediaType } from '@clew/contracts';
import type { LogoImage } from './ports';

/**
 * What an uploaded logo must be (D98). A PNG is recognised by its signature. An SVG is text a browser may run, so one
 * that could carry script, load something from elsewhere or embed foreign markup is refused whole rather than cleaned:
 * a municipality's mark exported from a drawing tool has none of it. The header draws the logo through `img`, where an
 * SVG cannot run script, and the route serves it under a sandboxing policy; this check is the third lock, not the only one.
 *
 * The check reads the file as XML, strictly, and holds it to what a drawing needs (`svgProblem`), so a spelling it does
 * not know is refused rather than let through: an element is known by its namespace, not by its prefix, a value is read
 * after its character references, and a stylesheet may not escape a character, import another or name a resource
 * outside the file. A file the browser would read differently is one this check refuses or one the browser cannot draw.
 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
/** The namespaces whose elements a browser draws or runs inside an SVG; an element in any other is inert metadata. */
const LIVE_NS = new Set([SVG_NS, 'http://www.w3.org/1999/xhtml', 'http://www.w3.org/1998/Math/MathML']);
/** What a drawing needs: groups, reuse inside the file, shapes, text, paints, clips, masks, filters and styles. */
const DRAWING = new Set(
  (
    'svg g defs symbol use title desc metadata path rect circle ellipse line polyline polygon text tspan textPath ' +
    'linearGradient radialGradient stop pattern clipPath mask marker image style filter feBlend feColorMatrix ' +
    'feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight ' +
    'feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feMerge feMergeNode feMorphology feOffset ' +
    'fePointLight feSpecularLighting feSpotLight feTile feTurbulence'
  ).split(' '),
);
const EMBEDDING = new Set(['foreignobject', 'iframe', 'embed', 'object', 'audio', 'video', 'canvas', 'feimage']);
const ANIMATION = new Set(['animate', 'animatemotion', 'animatetransform', 'set', 'mpath', 'discard']);
const OUTSIDE = 'resurser utanför bilden';
const INVALID = Symbol('invalid');
const NOT_SVG = Symbol('not svg');
type SvgProblem = string | typeof INVALID | typeof NOT_SVG;
const XML_SPACE = '[ \\t\\r\\n]';
const NAME = '[A-Za-z_][\\w.-]*(?::[A-Za-z_][\\w.-]*)?';
const START_TAG = new RegExp(`<(${NAME})`, 'y');
const ATTRIBUTE = new RegExp(`${XML_SPACE}+(${NAME})${XML_SPACE}*=${XML_SPACE}*(?:"([^"<]*)"|'([^'<]*)')`, 'y');
const TAG_CLOSE = new RegExp(`${XML_SPACE}*(/?)>`, 'y');
const END_TAG = new RegExp(`</(${NAME})${XML_SPACE}*>`, 'y');
const DECLARATION = /^﻿?<\?xml[ \t\r\n][^<>?]*\?>/;
const REFERENCE = /&(?:#([0-9]{1,7})|#x([0-9a-fA-F]{1,6})|(lt|gt|amp|quot|apos));/y;
const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Text or an attribute's value with its character references read, or null for a reference XML does not define. */
function decoded(raw: string): string | null {
  let out = '',
    at = 0;
  for (;;) {
    const amp = raw.indexOf('&', at);
    if (amp < 0) return out + raw.slice(at);
    out += raw.slice(at, amp);
    REFERENCE.lastIndex = amp;
    const m = REFERENCE.exec(raw);
    if (!m) return null;
    if (m[3]) out += NAMED[m[3]];
    else {
      const code = m[1] ? Number.parseInt(m[1], 10) : Number.parseInt(m[2]!, 16);
      if (!code || code > 0x10ffff) return null;
      out += String.fromCodePoint(code);
    }
    at = REFERENCE.lastIndex;
  }
}
/** Why a stylesheet or a value read as one may reach outside the file: an escaped character, an import, a resource. */
function cssProblem(css: string): string | undefined {
  if (css.includes('\\')) return 'kodade tecken i en stilmall';
  if (/@import/i.test(css)) return 'importerade stilmallar';
  if (/(?:^|[^\w-])(?:-webkit-)?image-set\(|(?:^|[^\w-])src\(/i.test(css)) return OUTSIDE;
  for (const m of css.matchAll(/url\(/gi))
    if (!/^url\([ \t\r\n]*["']?[ \t\r\n]*#/i.test(css.slice(m.index))) return OUTSIDE;
  return undefined;
}
/** Why one attribute is refused: a handler, a script address, a link out of the image, or a resource elsewhere. */
function attributeProblem(local: string, ns: string, value: string): string | undefined {
  if (!ns && /^on/i.test(local)) return 'händelseattribut';
  const plain = value.replace(/[\t\n\r]/g, '');
  if (/(javascript|vbscript)[ ]*:/i.test(plain)) return 'skriptadresser';
  if (local === 'href' && (!ns || ns === XLINK_NS)) {
    const target = plain.replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
    if (!/^#\S*$/.test(target) && !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]*$/i.test(target))
      return 'länkar ut ur bilden';
  }
  return cssProblem(value);
}
/** Why one element in a namespace a browser draws is refused, or undefined for a part of a drawing. */
function elementProblem(local: string, ns: string): string | undefined {
  const lower = local.toLowerCase();
  if (lower === 'script') return 'skript';
  if (!LIVE_NS.has(ns)) return undefined;
  if (ns !== SVG_NS || EMBEDDING.has(lower)) return 'inbäddat innehåll';
  if (ANIMATION.has(lower)) return 'animering';
  if (lower === 'a') return 'länkar ut ur bilden';
  return DRAWING.has(local) ? undefined : `elementet <${local}>`;
}
/**
 * Reads an SVG's text as XML and says the first thing in it a logo may not have: undefined when there is none, `INVALID`
 * when it is not XML this check reads, `NOT_SVG` when its root is not SVG's `svg`.
 */
function svgProblem(text: string): SvgProblem | undefined {
  const declaration = DECLARATION.exec(text);
  let at = declaration ? declaration[0].length : text.startsWith('﻿') ? 1 : 0;
  const open: Array<{ name: string; scope: Map<string, string>; css?: string }> = [];
  let rooted = false;
  while (at < text.length) {
    const lt = text.indexOf('<', at);
    const run = text.slice(at, lt < 0 ? text.length : lt);
    if (run) {
      const content = decoded(run);
      if (content === null) return INVALID;
      const top = open.at(-1);
      if (!top) {
        if (content.trim()) return INVALID;
      } else if (top.css !== undefined) top.css += content;
    }
    if (lt < 0) break;
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end < 0 || text.slice(lt + 4, end).includes('--')) return INVALID;
      at = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9),
        top = open.at(-1);
      if (end < 0 || !top) return INVALID;
      if (top.css !== undefined) top.css += text.slice(lt + 9, end);
      at = end + 3;
      continue;
    }
    if (text.startsWith('<!', lt)) return 'en dokumenttypsdeklaration';
    if (text.startsWith('<?', lt)) return 'en bearbetningsinstruktion';
    if (text.startsWith('</', lt)) {
      END_TAG.lastIndex = lt;
      const end = END_TAG.exec(text),
        top = open.pop();
      if (!end || !top || end[1] !== top.name) return INVALID;
      if (top.css !== undefined) {
        const problem = cssProblem(top.css);
        if (problem) return problem;
      }
      at = END_TAG.lastIndex;
      continue;
    }
    // A start tag: its name, its attributes in order, and whether it closes itself.
    START_TAG.lastIndex = lt;
    const start = START_TAG.exec(text);
    if (!start || (rooted && !open.length)) return INVALID;
    const name = start[1]!;
    const attributes: Array<[string, string]> = [];
    let selfClosing = false;
    at = START_TAG.lastIndex;
    for (;;) {
      TAG_CLOSE.lastIndex = at;
      const close = TAG_CLOSE.exec(text);
      if (close) {
        selfClosing = close[1] === '/';
        break;
      }
      ATTRIBUTE.lastIndex = at;
      const attribute = ATTRIBUTE.exec(text);
      if (!attribute) return INVALID;
      const value = decoded(attribute[2] ?? attribute[3]!);
      if (value === null || attributes.some(([n]) => n === attribute[1])) return INVALID;
      attributes.push([attribute[1]!, value]);
      at = ATTRIBUTE.lastIndex;
    }
    at = TAG_CLOSE.lastIndex;
    const parent = open.at(-1);
    if (parent?.css !== undefined) return 'inbäddat innehåll';
    // The namespaces this element declares, over those it is inside of.
    const scope = new Map(parent?.scope ?? [['xml', 'http://www.w3.org/XML/1998/namespace']]);
    for (const [n, value] of attributes)
      if (n === 'xmlns') scope.set('', value);
      else if (n.startsWith('xmlns:')) {
        if (!value) return INVALID;
        scope.set(n.slice(6), value);
      }
    const qualified = (n: string): [string, string] | null => {
      const colon = n.indexOf(':');
      if (colon < 0) return [n, ''];
      const ns = scope.get(n.slice(0, colon));
      return ns === undefined ? null : [n.slice(colon + 1), ns];
    };
    const element = name.includes(':') ? qualified(name) : ([name, scope.get('') ?? ''] as [string, string]);
    if (!element || name.startsWith('xmlns:')) return INVALID;
    if (!rooted && (element[0] !== 'svg' || element[1] !== SVG_NS)) return NOT_SVG;
    rooted = true;
    // A script is named as one before anything it carries; any other element after its attributes, so a link that
    // runs script is named for its address.
    if (element[0].toLowerCase() === 'script') return 'skript';
    for (const [n, value] of attributes) {
      if (n === 'xmlns' || n.startsWith('xmlns:')) continue;
      const attribute = qualified(n);
      if (!attribute) return INVALID;
      const problem = attributeProblem(attribute[0], attribute[1], value);
      if (problem) return problem;
    }
    const problem = elementProblem(...element);
    if (problem) return problem;
    if (!selfClosing)
      open.push({ name, scope, ...(element[1] === SVG_NS && element[0] === 'style' ? { css: '' } : {}) });
  }
  return rooted && !open.length ? undefined : INVALID;
}
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
  const problem = svgProblem(text);
  if (problem === NOT_SVG) return { problem: `${label} är inte en SVG-bild.` };
  if (problem === INVALID) return { problem: `${label} går inte att läsa som SVG-bild.` };
  if (problem) return { problem: `${label} innehåller ${problem}, vilket inte tillåts i en logotyp.` };
  return { mediaType: input.mediaType, bytes };
}
export const isLogoProblem = (value: LogoImage | LogoProblem): value is LogoProblem => 'problem' in value;
