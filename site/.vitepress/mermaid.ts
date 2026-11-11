type Token = { info: string; content: string };
type Render = (tokens: Token[], index: number, options: unknown, env: unknown, self: unknown) => string;
type Markdown = { renderer: { rules: Record<string, Render | undefined> } };

/** A ```mermaid block becomes the theme's Mermaid component (theme/Mermaid.vue); every other block is untouched. */
export function mermaidBlocks(md: Markdown) {
  const fence = md.renderer.rules.fence!;
  let count = 0;
  md.renderer.rules.fence = (tokens, index, ...rest) => {
    const token = tokens[index]!;
    if (token.info.trim() !== 'mermaid') return fence(tokens, index, ...rest);
    return `<Mermaid id="mermaid-${++count}" code="${encodeURIComponent(token.content)}" />\n`;
  };
}
