/**
 * 公告富文本编辑器（Markdown）：工具栏插入语法 + 实时预览。
 * 预览复用主站的轻量 Markdown 渲染器，保证「后台所见」与「用户端所见」一致。
 */
import { useRef, useState } from "react";
import { Markdown } from "../../lib/markdown";
import "./rich-text-editor.css";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
}

interface ToolAction {
  key: string;
  label: string;
  title: string;
  /** 包裹选中文本（前后各插一段） */
  wrap?: [string, string];
  /** 在行首插入前缀（列表/标题等） */
  prefix?: string;
  /** 直接插入的片段 */
  insert?: string;
  /** 是否独占一行 */
  block?: boolean;
}

const ACTIONS: ToolAction[] = [
  { key: "bold", label: "粗体", title: "加粗（**文本**）", wrap: ["**", "**"] },
  { key: "italic", label: "斜体", title: "斜体（*文本*）", wrap: ["*", "*"] },
  { key: "h2", label: "标题", title: "二级标题", prefix: "## ", block: true },
  { key: "ul", label: "列表", title: "无序列表", prefix: "- ", block: true },
  { key: "ol", label: "编号", title: "有序列表", prefix: "1. ", block: true },
  { key: "quote", label: "引用", title: "引用", prefix: "> ", block: true },
  { key: "link", label: "链接", title: "插入链接", wrap: ["[", "](https://)"] },
  { key: "code", label: "代码", title: "行内代码（`代码`）", wrap: ["`", "`"] },
  { key: "hr", label: "分割线", title: "插入分割线", insert: "\n---\n", block: true },
];

export function RichTextEditor({
  value,
  onChange,
  placeholder = "支持 Markdown 语法",
  rows = 12,
  maxLength = 8000,
}: RichTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [preview, setPreview] = useState(false);

  function applyAction(action: ToolAction) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end);

    if (action.wrap) {
      const [before, after] = action.wrap;
      const next = value.slice(0, start) + before + selected + after + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        textarea.focus();
        const cursor = start + before.length + selected.length;
        textarea.setSelectionRange(cursor, cursor);
      });
      return;
    }

    if (action.prefix) {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const next = value.slice(0, lineStart) + action.prefix + value.slice(lineStart);
      onChange(next);
      requestAnimationFrame(() => {
        textarea.focus();
        const cursor = start + action.prefix!.length;
        textarea.setSelectionRange(cursor, cursor);
      });
      return;
    }

    if (action.insert) {
      const needsBreak = start > 0 && value[start - 1] !== "\n";
      const fragment = (needsBreak ? "\n" : "") + action.insert;
      const next = value.slice(0, start) + fragment + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        textarea.focus();
        const cursor = start + fragment.length;
        textarea.setSelectionRange(cursor, cursor);
      });
    }
  }

  return (
    <div className="adm-rte">
      <div className="adm-rte-bar">
        <div className="adm-rte-tools">
          {ACTIONS.map((action) => (
            <button
              key={action.key}
              type="button"
              className="adm-rte-tool"
              title={action.title}
              disabled={preview}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyAction(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
        <div className="adm-rte-tabs">
          <button
            type="button"
            className={`adm-rte-tab${preview ? "" : " is-active"}`}
            onClick={() => setPreview(false)}
          >
            编辑
          </button>
          <button
            type="button"
            className={`adm-rte-tab${preview ? " is-active" : ""}`}
            onClick={() => setPreview(true)}
          >
            预览
          </button>
        </div>
      </div>

      {preview ? (
        <div className="adm-rte-preview">
          {value.trim() ? (
            <Markdown text={value} />
          ) : (
            <p className="adm-rte-empty">暂无内容</p>
          )}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className="admin-textarea adm-rte-input"
          rows={rows}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}

      <div className="adm-rte-foot">
        <span>支持 Markdown 语法</span>
        <span className={value.length > maxLength * 0.9 ? "is-warn" : ""}>
          {value.length} / {maxLength}
        </span>
      </div>
    </div>
  );
}
