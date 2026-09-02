"use client";

import {
  $createLinkNode,
  $isLinkNode,
  LinkNode,
  TOGGLE_LINK_COMMAND,
} from "@lexical/link";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
  REMOVE_LIST_COMMAND,
  $isListNode,
} from "@lexical/list";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  HEADING,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
  ORDERED_LIST,
  type Transformer,
  UNORDERED_LIST,
} from "@lexical/markdown";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import {
  $createHeadingNode,
  $isHeadingNode,
  HeadingNode,
} from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  KEY_DOWN_COMMAND,
  SELECTION_CHANGE_COMMAND,
  type LexicalEditor,
} from "lexical";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const informationTransformers: Transformer[] = [
  HEADING,
  UNORDERED_LIST,
  ORDERED_LIST,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
];

type BlockType = "paragraph" | "h2" | "h3";

type OrganisationRichTextEditorProps = {
  disabled: boolean;
  initialMarkdown: string;
  onChange: (value: { markdown: string; textLength: number }) => void;
  onMessage: (message: string | null) => void;
  editorId?: string;
  ariaLabel?: string;
  describedBy?: string;
  placeholder?: string;
};

function getEditorValue() {
  return {
    markdown: $convertToMarkdownString(informationTransformers),
    textLength: [...$getRoot().getTextContent()].length,
  };
}

function isSafeLinkUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsedUrl.protocol);
  } catch {
    return false;
  }
}

function normaliseLinkUrl(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue) return null;

  const url = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedValue)
    ? `mailto:${trimmedValue}`
    : /^[a-z][a-z\d+.-]*:/i.test(trimmedValue)
      ? trimmedValue
      : `https://${trimmedValue}`;

  return isSafeLinkUrl(url) ? url : null;
}

function getSelectionBlockType() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return "paragraph" satisfies BlockType;

  const anchorNode = selection.anchor.getNode();
  const topLevelNode =
    anchorNode.getKey() === "root"
      ? anchorNode
      : anchorNode.getTopLevelElementOrThrow();

  if ($isListNode(topLevelNode)) {
    return topLevelNode.getListType() === "number"
      ? "ordered-list"
      : "unordered-list";
  }

  if ($isHeadingNode(topLevelNode)) {
    const tag = topLevelNode.getTag();
    return tag === "h3" ? "h3" : "h2";
  }

  return "paragraph";
}

function ToolbarPlugin({
  disabled,
  onMessage,
}: {
  disabled: boolean;
  onMessage: (message: string | null) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [blockType, setBlockType] = useState<
    BlockType | "ordered-list" | "unordered-list"
  >("paragraph");
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isLink, setIsLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [hasSelectedText, setHasSelectedText] = useState(false);

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;

    setIsBold(selection.hasFormat("bold"));
    setIsItalic(selection.hasFormat("italic"));
    setHasSelectedText(!selection.isCollapsed());
    setBlockType(getSelectionBlockType());

    const selectedNode = selection.isBackward()
      ? selection.anchor.getNode()
      : selection.focus.getNode();
    const linkNode = $isLinkNode(selectedNode)
      ? selectedNode
      : $isLinkNode(selectedNode.getParent())
        ? selectedNode.getParent()
        : null;

    setIsLink(Boolean(linkNode));
    setLinkUrl($isLinkNode(linkNode) ? linkNode.getURL() : "");
  }, []);

  const openLinkPrompt = useCallback(() => {
    if (disabled) return;

    if (isLink) {
      const action = window.prompt(
        "Update the link URL, or leave it empty to remove the link.",
        linkUrl,
      );
      if (action === null) return;
      if (!action.trim()) {
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
        onMessage(null);
        return;
      }

      const url = normaliseLinkUrl(action);
      if (!url) {
        onMessage("Enter a valid http, https, or email link.");
        return;
      }

      editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
      onMessage(null);
      return;
    }

    const action = window.prompt("Link URL", "https://");
    if (!action) return;

    const url = normaliseLinkUrl(action);
    if (!url) {
      onMessage("Enter a valid http, https, or email link.");
      return;
    }

    if (hasSelectedText) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
    } else {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;

        const linkNode = $createLinkNode(url);
        linkNode.append(
          $createTextNode(url.startsWith("mailto:") ? url.slice(7) : url),
        );
        selection.insertNodes([linkNode]);
        linkNode.selectEnd();
      });
    }
    onMessage(null);
  }, [disabled, editor, hasSelectedText, isLink, linkUrl, onMessage]);

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(({ editorState }) => {
          editorState.read(updateToolbar);
        }),
        editor.registerCommand(
          SELECTION_CHANGE_COMMAND,
          () => {
            updateToolbar();
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          KEY_DOWN_COMMAND,
          (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
              event.preventDefault();
              openLinkPrompt();
              return true;
            }

            return false;
          },
          COMMAND_PRIORITY_HIGH,
        ),
      ),
    [editor, openLinkPrompt, updateToolbar],
  );

  function setTextBlock(nextBlockType: BlockType) {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;

      $setBlocksType(selection, () =>
        nextBlockType === "paragraph"
          ? $createParagraphNode()
          : $createHeadingNode(nextBlockType),
      );
    });
  }

  function toggleList(type: "ordered-list" | "unordered-list") {
    if (blockType === type) {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      return;
    }

    editor.dispatchCommand(
      type === "ordered-list"
        ? INSERT_ORDERED_LIST_COMMAND
        : INSERT_UNORDERED_LIST_COMMAND,
      undefined,
    );
  }

  const buttonClass =
    "inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-55";

  function toolbarButtonClass(active: boolean) {
    return `${buttonClass} ${
      active
        ? "border-brand/50 bg-brand-subtle text-brand-deep"
        : "border-border bg-surface text-neutral-strong hover:bg-brand-subtle hover:text-brand-deep"
    }`;
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-t-xl border border-b-0 border-border bg-surface-muted p-2"
      role="toolbar"
      aria-label="Content formatting"
    >
      <select
        aria-label="Text style"
        title="Text style"
        value={
          blockType === "h2" || blockType === "h3" ? blockType : "paragraph"
        }
        disabled={disabled}
        onChange={(event) => setTextBlock(event.target.value as BlockType)}
        className="min-h-10 rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-neutral-strong outline-none transition hover:bg-brand-subtle focus:border-brand disabled:opacity-55"
      >
        <option value="paragraph">Normal text</option>
        <option value="h2">Heading</option>
        <option value="h3">Subheading</option>
      </select>
      <button
        type="button"
        aria-label="Bold"
        aria-pressed={isBold}
        title="Bold (Ctrl+B)"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
        className={toolbarButtonClass(isBold)}
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        aria-label="Italic"
        aria-pressed={isItalic}
        title="Italic (Ctrl+I)"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
        className={toolbarButtonClass(isItalic)}
      >
        <em>I</em>
      </button>
      <button
        type="button"
        aria-label="Bullet list"
        aria-pressed={blockType === "unordered-list"}
        title="Bullet list"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => toggleList("unordered-list")}
        className={toolbarButtonClass(blockType === "unordered-list")}
      >
        <span aria-hidden="true">•</span>
        <span className="ml-1.5">List</span>
      </button>
      <button
        type="button"
        aria-label="Numbered list"
        aria-pressed={blockType === "ordered-list"}
        title="Numbered list"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => toggleList("ordered-list")}
        className={toolbarButtonClass(blockType === "ordered-list")}
      >
        <span aria-hidden="true">1.</span>
        <span className="ml-1.5">List</span>
      </button>
      <button
        type="button"
        aria-label={isLink ? "Edit link" : "Add link"}
        aria-pressed={isLink}
        title={isLink ? "Edit link (Ctrl+K)" : "Add link (Ctrl+K)"}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={openLinkPrompt}
        className={toolbarButtonClass(isLink)}
      >
        Link
      </button>
    </div>
  );
}

function EditablePlugin({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  return null;
}

function ValuePlugin({
  onChange,
}: {
  onChange: OrganisationRichTextEditorProps["onChange"];
}) {
  const [editor] = useLexicalComposerContext();
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    editor.getEditorState().read(() => onChangeRef.current(getEditorValue()));
  }, [editor]);

  return (
    <OnChangePlugin
      ignoreSelectionChange
      onChange={(editorState) => {
        editorState.read(() => onChange(getEditorValue()));
      }}
    />
  );
}

function handleEditorError(error: Error, editor?: LexicalEditor) {
  editor?.setEditable(false);
  throw error;
}

export function OrganisationRichTextEditor({
  disabled,
  initialMarkdown,
  onChange,
  onMessage,
  editorId = "information-card-content",
  ariaLabel = "Content",
  describedBy = "information-card-content-help information-card-content-count",
  placeholder = "Write the information this organisation wants to publish…",
}: OrganisationRichTextEditorProps) {
  const initialConfig = useMemo(
    () => ({
      namespace: "OrganisationInformationEditor",
      editable: !disabled,
      nodes: [HeadingNode, ListNode, ListItemNode, LinkNode],
      theme: {
        heading: {
          h1: "mt-5 text-xl font-semibold tracking-[-0.02em] text-foreground first:mt-0",
          h2: "mt-5 text-xl font-semibold tracking-[-0.02em] text-foreground first:mt-0",
          h3: "mt-4 text-base font-semibold text-foreground first:mt-0",
          h4: "mt-4 text-base font-semibold text-foreground first:mt-0",
          h5: "mt-4 text-base font-semibold text-foreground first:mt-0",
          h6: "mt-4 text-base font-semibold text-foreground first:mt-0",
        },
        link: "font-semibold text-brand-strong underline decoration-brand/35 underline-offset-2",
        list: {
          listitem: "my-1 pl-1",
          nested: { listitem: "list-none" },
          ol: "my-3 list-decimal space-y-1 pl-7 marker:font-semibold marker:text-brand-strong",
          ul: "my-3 list-disc space-y-1 pl-7 marker:text-brand-strong",
        },
        paragraph: "mt-3 first:mt-0",
        text: {
          bold: "font-semibold text-foreground",
          italic: "italic",
        },
      },
      editorState: () => {
        $convertFromMarkdownString(initialMarkdown, informationTransformers);
      },
      onError: handleEditorError,
    }),
    [disabled, initialMarkdown],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <ToolbarPlugin disabled={disabled} onMessage={onMessage} />
      <div className="relative rounded-b-xl border border-border bg-surface focus-within:border-brand">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              id={editorId}
              aria-label={ariaLabel}
              aria-describedby={describedBy}
              className="min-h-72 max-h-[52vh] w-full overflow-y-auto overflow-x-hidden rounded-b-xl px-4 py-3 text-sm leading-6 text-foreground outline-none sm:px-5"
            />
          }
          placeholder={
            <p className="pointer-events-none absolute left-4 top-3 text-sm leading-6 text-muted-foreground sm:left-5">
              {placeholder}
            </p>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <ListPlugin hasStrictIndent />
      <LinkPlugin
        validateUrl={isSafeLinkUrl}
        attributes={{ rel: "noopener noreferrer", target: "_blank" }}
      />
      <ValuePlugin onChange={onChange} />
      <EditablePlugin disabled={disabled} />
    </LexicalComposer>
  );
}
