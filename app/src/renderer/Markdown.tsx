import type { JSX } from 'react';

import {
  parseMarkdown,
  type MarkdownBlock,
  type MarkdownInline,
} from '../shared/markdown';

/**
 * An agent's reply, formatted.
 *
 * Every node below is a React element with text children. There is no
 * `dangerouslySetInnerHTML` in this file, none in `markdown.ts`, and the parser
 * has no node type that could carry markup — so a reply containing `<script>` is
 * drawn as the characters `<script>` and there is no path by which it could be
 * anything else. That is DSP-59 #4, and it is a property of the shape of the data
 * rather than of a sanitiser being configured correctly.
 *
 * Text is re-parsed on every render, which is once per streaming delta. The input
 * is one reply, the parser is a single pass and React updates only what changed;
 * measured against the 4 000-character replies this window already shows, that is
 * not worth caching away the simplicity of "what is on screen is what the text
 * says right now".
 */
export function Markdown({
  text,
  testId,
}: {
  readonly text: string;
  readonly testId?: string;
}): JSX.Element {
  const blocks = parseMarkdown(text);
  return (
    <div
      className="markdown"
      {...(testId === undefined ? {} : { 'data-ev': testId })}
    >
      <Blocks blocks={blocks} />
    </div>
  );
}

function Blocks({ blocks }: { readonly blocks: readonly MarkdownBlock[] }): JSX.Element {
  return (
    <>
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </>
  );
}

function Block({ block }: { readonly block: MarkdownBlock }): JSX.Element {
  switch (block.kind) {
    case 'paragraph':
      return (
        <p className="markdown__p">
          <Inlines nodes={block.content} />
        </p>
      );
    case 'heading': {
      const Tag = `h${String(block.level)}` as 'h1';
      return (
        <Tag className={`markdown__h markdown__h--${String(block.level)}`}>
          <Inlines nodes={block.content} />
        </Tag>
      );
    }
    case 'code':
      return (
        // The one place a horizontal scroll is wanted: §9.1 allows it for code and
        // rules it out for the conversation.
        <pre className="markdown__pre">
          <code
            className="markdown__code-block"
            {...(block.language === null ? {} : { 'data-language': block.language })}
          >
            {block.text}
          </code>
        </pre>
      );
    case 'list':
      return block.ordered ? (
        <ol className="markdown__list" start={block.start}>
          {block.items.map((item, index) => (
            <li key={index}>
              <Blocks blocks={item.blocks} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className="markdown__list">
          {block.items.map((item, index) => (
            <li key={index}>
              <Blocks blocks={item.blocks} />
            </li>
          ))}
        </ul>
      );
    case 'quote':
      return (
        <blockquote className="markdown__quote">
          <Blocks blocks={block.blocks} />
        </blockquote>
      );
    case 'rule':
      return <hr className="markdown__rule" />;
  }
}

function Inlines({ nodes }: { readonly nodes: readonly MarkdownInline[] }): JSX.Element {
  return (
    <>
      {nodes.map((node, index) => (
        <Inline key={index} node={node} />
      ))}
    </>
  );
}

function Inline({ node }: { readonly node: MarkdownInline }): JSX.Element {
  switch (node.kind) {
    case 'text':
      return <>{node.text}</>;
    case 'strong':
      return (
        <strong>
          <Inlines nodes={node.children} />
        </strong>
      );
    case 'emphasis':
      return (
        <em>
          <Inlines nodes={node.children} />
        </em>
      );
    case 'code':
      return <code className="markdown__code">{node.text}</code>;
    case 'link':
      // A refused target keeps its text. Nothing is hidden and nothing is
      // clickable that DSpatch would not be willing to open.
      return node.href === null ? (
        <span className="markdown__link markdown__link--inert">
          <Inlines nodes={node.children} />
        </span>
      ) : (
        <a
          className="markdown__link"
          href={node.href}
          target="_blank"
          rel="noreferrer noopener"
        >
          <Inlines nodes={node.children} />
        </a>
      );
  }
}
