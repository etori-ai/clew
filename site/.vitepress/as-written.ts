type Token = {
  type: string;
  content: string;
  children: Token[] | null;
  attrSet(name: string, value: string): void;
};
type Render = (tokens: Token[], index: number, options: unknown, env: unknown, self: unknown) => string;
type Markdown = {
  core: { ruler: { push(name: string, rule: (state: { tokens: Token[] }) => void): void } };
  renderer: { rules: Record<string, Render | undefined> };
};

/** The HTML a document may use on purpose. Everything else in angle brackets is a placeholder. */
const html = /^<\/?(br|sub|sup|kbd|details|summary|img)(\s[^>]*)?\/?>$/i;
const comment = /^<!--[\s\S]*-->$/;

/**
 * VitePress compiles every page as a Vue template, and the documents are not written for one. Two things in them
 * would stop the build: a placeholder in angle brackets outside code, such as "God morgon, <first name>", which is
 * read as a tag that never closes, and double curly braces, such as `columns={{ minWidth: 280 }}`, which are read as
 * an expression. Both are shown as the text they are, so no document has to be written for the site.
 */
export function asWritten(md: Markdown) {
  md.core.ruler.push('clew-literal-placeholders', state => {
    const visit = (token: Token) => {
      const raw = token.type === 'html_inline' || token.type === 'html_block';
      if (raw && !comment.test(token.content.trim()) && !html.test(token.content.trim())) token.type = 'text';
      token.children?.forEach(visit);
    };
    state.tokens.forEach(visit);
  });

  const code = md.renderer.rules.code_inline!;
  md.renderer.rules.code_inline = (tokens, index, ...rest) => {
    tokens[index]!.attrSet('v-pre', '');
    return code(tokens, index, ...rest);
  };
  const text = md.renderer.rules.text!;
  md.renderer.rules.text = (...args) => text(...args).replaceAll('{{', '&#123;&#123;');
}
