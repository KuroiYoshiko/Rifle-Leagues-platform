import ReactMarkdown from "react-markdown";

const allowedElements = [
  "p",
  "strong",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "a",
];

function safeLinkUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsedUrl.protocol)
      ? url
      : "";
  } catch {
    return "";
  }
}

export function OrganisationInformationContent({ content }: { content: string }) {
  return (
    <div className="min-w-0 break-words text-[0.9375rem] leading-7 text-muted-foreground">
      <ReactMarkdown
        allowedElements={allowedElements}
        skipHtml
        unwrapDisallowed
        urlTransform={safeLinkUrl}
        components={{
          p: ({ children }) => <p className="mt-4 first:mt-0">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em>{children}</em>,
          h1: ({ children }) => (
            <h3 className="mt-7 text-lg font-semibold tracking-[-0.02em] text-foreground first:mt-0">
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h3 className="mt-7 text-lg font-semibold tracking-[-0.02em] text-foreground first:mt-0">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-6 font-semibold text-foreground first:mt-0">
              {children}
            </h4>
          ),
          h4: ({ children }) => (
            <h4 className="mt-6 font-semibold text-foreground first:mt-0">
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h4 className="mt-6 font-semibold text-foreground first:mt-0">
              {children}
            </h4>
          ),
          h6: ({ children }) => (
            <h4 className="mt-6 font-semibold text-foreground first:mt-0">
              {children}
            </h4>
          ),
          ul: ({ children }) => (
            <ul className="mt-4 list-disc space-y-2 pl-6 marker:text-brand-strong">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mt-4 list-decimal space-y-2 pl-6 marker:font-semibold marker:text-brand-strong">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-1">{children}</li>,
          a: ({ children, href }) =>
            href ? (
              <a
                href={href}
                target={href.startsWith("mailto:") ? undefined : "_blank"}
                rel={href.startsWith("mailto:") ? undefined : "noopener noreferrer"}
                className="font-semibold text-brand-strong underline decoration-brand/35 underline-offset-2 transition hover:text-brand-deep"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
