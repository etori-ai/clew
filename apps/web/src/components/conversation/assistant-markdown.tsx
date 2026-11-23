import type { ComponentProps } from 'react';
import { Markdown } from '@clew/ui';

type MarkdownProps = ComponentProps<typeof Markdown>;
const components: NonNullable<MarkdownProps['components']> = {
  image: ({ alt }) => alt,
};

/** An assistant can describe an image. Displaying its answer must never fetch that image on the person's behalf. */
export function AssistantMarkdown(
  props: Pick<MarkdownProps, 'children' | 'headingLevelStart' | 'isStreaming' | 'sources' | 'citationStyle'>,
) {
  return <Markdown {...props} density="compact" components={components} />;
}
