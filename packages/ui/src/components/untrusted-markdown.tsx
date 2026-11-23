import type { ComponentProps } from 'react';
import { Markdown } from '@astryxdesign/core/Markdown';

type MarkdownProps = ComponentProps<typeof Markdown>;
const components: NonNullable<MarkdownProps['components']> = {
  image: ({ alt }) => alt,
};

/**
 * Markdown that Clew did not write: a model's answer, another system's assistant's, a source's text view. Its text can
 * name an image at any address, so an image is drawn as its alternative text and drawing it never fetches anything on
 * the person's behalf. Links, citations and the rest are Astryx's `Markdown` as it is.
 */
export function UntrustedMarkdown(
  props: Pick<MarkdownProps, 'children' | 'headingLevelStart' | 'isStreaming' | 'sources' | 'citationStyle'>,
) {
  return <Markdown {...props} density="compact" components={components} />;
}
