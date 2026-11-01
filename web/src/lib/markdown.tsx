/**
 * 极简 Markdown 渲染器。
 *
 * 只支持本项目文档实际用到的语法：标题（# ~ ####）、段落、无序/有序列表、
 * 引用块、分隔线，以及行内的**粗体**、`行内代码`、[链接](url)。
 * 不引入第三方依赖，避免为两份静态文档增加体积；内容由服务端自带，
 * 因此不处理原始 HTML（未转义的 HTML 会被当作文本输出）。
 */

import type { ReactNode } from "react";

const INLINE_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let index = 0;

  INLINE_PATTERN.lastIndex = 0;
  let match = INLINE_PATTERN.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${index}`;
    if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const label = link?.[1] ?? token;
      const href = link?.[2] ?? "#";
      nodes.push(
        <a key={key} href={href} target="_blank" rel="noreferrer noopener">
          {label}
        </a>,
      );
    }
    lastIndex = match.index + token.length;
    index += 1;
    match = INLINE_PATTERN.exec(text);
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function isUnorderedItem(line: string): boolean {
  return /^[-*]\s+/.test(line);
}

function isOrderedItem(line: string): boolean {
  return /^\d+\.\s+/.test(line);
}

function isHeading(line: string): boolean {
  return /^#{1,4}\s+/.test(line);
}

function isRule(line: string): boolean {
  return /^(-{3,}|\*{3,}|_{3,})$/.test(line);
}

export interface MarkdownProps {
  /** Markdown 原文 */
  text: string;
  className?: string;
}

/** 把 Markdown 文本渲染为 React 节点（样式见 styles.css 的 .markdown 规则）。 */
export function Markdown({ text, className }: MarkdownProps): ReactNode {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let blockCount = 0;

  const nextKey = (): string => {
    const key = `md-${blockCount}`;
    blockCount += 1;
    return key;
  };

  while (index < lines.length) {
    const line = (lines[index] ?? "").trim();
    if (line === "") {
      index += 1;
      continue;
    }

    if (isRule(line)) {
      const key = nextKey();
      blocks.push(<hr key={key} />);
      index += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const depth = (heading[1] ?? "#").length;
      const key = nextKey();
      const content = renderInline(heading[2] ?? "", `${key}-h`);
      if (depth === 1) {
        blocks.push(<h1 key={key}>{content}</h1>);
      } else if (depth === 2) {
        blocks.push(<h2 key={key}>{content}</h2>);
      } else if (depth === 3) {
        blocks.push(<h3 key={key}>{content}</h3>);
      } else {
        blocks.push(<h4 key={key}>{content}</h4>);
      }
      index += 1;
      continue;
    }

    if (isUnorderedItem(line)) {
      const key = nextKey();
      const items: string[] = [];
      while (index < lines.length && isUnorderedItem((lines[index] ?? "").trim())) {
        items.push((lines[index] ?? "").trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={key}>
          {items.map((item, itemIndex) => (
            <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (isOrderedItem(line)) {
      const key = nextKey();
      const items: string[] = [];
      while (index < lines.length && isOrderedItem((lines[index] ?? "").trim())) {
        items.push((lines[index] ?? "").trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ol key={key}>
          {items.map((item, itemIndex) => (
            <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (line.startsWith(">")) {
      const key = nextKey();
      const parts: string[] = [];
      while (index < lines.length && (lines[index] ?? "").trim().startsWith(">")) {
        parts.push((lines[index] ?? "").trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={key}>{renderInline(parts.join(""), `${key}-q`)}</blockquote>);
      continue;
    }

    const key = nextKey();
    const parts: string[] = [];
    while (index < lines.length) {
      const current = (lines[index] ?? "").trim();
      if (
        current === "" ||
        isHeading(current) ||
        isUnorderedItem(current) ||
        isOrderedItem(current) ||
        current.startsWith(">") ||
        isRule(current)
      ) {
        break;
      }
      parts.push(current);
      index += 1;
    }
    blocks.push(<p key={key}>{renderInline(parts.join(""), `${key}-p`)}</p>);
  }

  return <div className={className ? `markdown ${className}` : "markdown"}>{blocks}</div>;
}
