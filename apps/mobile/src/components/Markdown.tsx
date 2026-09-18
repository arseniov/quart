// src/components/Markdown.tsx
import { useMemo } from 'react';
import { Markdown } from 'react-native-markdown-display';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeRemark from 'rehype-remark';
import remarkStringify from 'remark-stringify';

// Tags, attributes, and URL protocols safe for user-authored issue/idea bodies.
// No img/iframe/script/style, and only https + mailto URLs are allowed.
const STRICT_SCHEMA = {
  ...defaultSchema,
  tagNames: ['p', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'br', 'h2', 'h3'],
  attributes: { a: ['href'] },
  protocols: { href: ['https', 'mailto'] },
};

// Round-trip markdown -> hast (sanitized) -> markdown so the sanitizer
// drops disallowed nodes/attrs/protocols before react-native-markdown-display
// ever sees the source.
export function sanitize(source: string): string {
  return String(
    unified()
      .use(remarkParse)
      .use(remarkRehype)
      .use(rehypeSanitize, STRICT_SCHEMA)
      .use(rehypeRemark)
      .use(remarkStringify)
      .processSync(source),
  );
}

export function SafeMarkdown({ source }: { source: string }) {
  const safe = useMemo(() => sanitize(source), [source]);
  return <Markdown>{safe}</Markdown>;
}
