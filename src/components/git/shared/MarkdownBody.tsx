import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkGemoji from "remark-gemoji";

interface MarkdownBodyProps {
  content: string;
  className?: string;
}

/**
 * Renders markdown content with GitHub Flavored Markdown support.
 * Handles images, links, code blocks, tables, and other GFM features.
 */
export function MarkdownBody({ content, className = "" }: MarkdownBodyProps) {
  if (!content) {
    return (
      <p className="text-xs italic text-maestro-muted">No description provided.</p>
    );
  }

  // Convert <image src="..."> tags to standard markdown images
  const processedContent = content.replace(/<image\s+src="([^"]+)"[^>]*>/gi, '![]($1)');

  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkGemoji]}
        rehypePlugins={[rehypeRaw]}
        components={{
          // Style links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-maestro-accent hover:underline"
            >
              {children}
            </a>
          ),
          // Style images
          img: ({ src, alt }) => (
            <img
              src={src}
              alt={alt || ""}
              className="my-2 max-w-full rounded border border-maestro-border"
              loading="lazy"
            />
          ),
          // Style code blocks
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded bg-maestro-bg p-2 text-[10px]">
              {children}
            </pre>
          ),
          // Style inline code
          code: ({ children, className }) => {
            // Check if this is a code block (has language class) or inline code
            const isCodeBlock = className?.includes("language-");
            if (isCodeBlock) {
              return <code className="text-maestro-text">{children}</code>;
            }
            return (
              <code className="rounded bg-maestro-bg px-1 py-0.5 text-[10px] text-maestro-text">
                {children}
              </code>
            );
          },
          // Style paragraphs
          p: ({ children }) => (
            <p className="mb-2 text-xs leading-relaxed text-maestro-muted last:mb-0">
              {children}
            </p>
          ),
          // Style lists
          ul: ({ children }) => (
            <ul className="mb-2 ml-4 list-disc text-xs text-maestro-muted">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2 ml-4 list-decimal text-xs text-maestro-muted">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="mb-0.5">{children}</li>,
          // Style headers
          h1: ({ children }) => (
            <h1 className="mb-2 mt-3 text-sm font-semibold text-maestro-text first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-3 text-sm font-medium text-maestro-text first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1 mt-2 text-xs font-medium text-maestro-text first:mt-0">
              {children}
            </h3>
          ),
          // Style blockquotes
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-maestro-border pl-2 text-xs italic text-maestro-muted">
              {children}
            </blockquote>
          ),
          // Style horizontal rules
          hr: () => <hr className="my-3 border-maestro-border" />,
          // Style tables
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="min-w-full text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-maestro-border bg-maestro-bg px-2 py-1 text-left font-medium text-maestro-text">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-maestro-border px-2 py-1 text-maestro-muted">
              {children}
            </td>
          ),
          // Style task list items (GFM)
          input: ({ checked }) => (
            <input
              type="checkbox"
              checked={checked}
              disabled
              className="mr-1 h-3 w-3"
            />
          ),
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
