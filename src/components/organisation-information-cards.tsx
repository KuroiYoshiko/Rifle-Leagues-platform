"use client";

import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import {
  type FormEvent,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  createOrganisationInformationCard,
  deleteOrganisationInformationCard,
  reorderOrganisationInformationCards,
  updateOrganisationInformationCard,
  type InformationCardActionResult,
} from "@/app/(app)/organisations/[slug]/information/actions";
import { OrganisationInformationContent } from "@/components/organisation-information-content";
import type {
  Organisation,
  OrganisationInformationCard,
} from "@/lib/organisations";

type EditorState =
  | { mode: "add" }
  | { mode: "edit"; card: OrganisationInformationCard };

type Draft = { title: string; content: string };

const emptyDraft: Draft = { title: "", content: "" };

function ActionMessage({ result }: { result: InformationCardActionResult | null }) {
  if (!result) return null;

  return (
    <p
      className={`text-sm leading-6 ${
        result.status === "error" ? "text-danger" : "text-success"
      }`}
      role={result.status === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {result.message}
    </p>
  );
}

function InformationCardArticle({
  card,
  index,
  ownerControls,
  dragHandleRef,
  dragging = false,
  onEdit,
  onDelete,
}: {
  card: OrganisationInformationCard;
  index: number;
  ownerControls: boolean;
  dragHandleRef?: (element: Element | null) => void;
  dragging?: boolean;
  onEdit?: (card: OrganisationInformationCard) => void;
  onDelete?: (card: OrganisationInformationCard) => void;
}) {
  return (
    <article
      className={`min-w-0 rounded-2xl border bg-surface p-6 shadow-xs transition sm:p-8 ${
        dragging
          ? "border-brand/60 opacity-80 shadow-lg"
          : "border-border"
      }`}
      aria-labelledby={`information-card-title-${card.id}`}
    >
      <div className="flex min-w-0 items-start gap-3 sm:gap-4">
        {ownerControls ? (
          <button
            ref={dragHandleRef}
            type="button"
            aria-label={`Reorder ${card.title}`}
            aria-describedby="information-reorder-instructions"
            title="Drag to reorder. Keyboard users can press Space, then use the arrow keys."
            className="mt-0.5 inline-flex size-11 shrink-0 touch-none cursor-grab items-center justify-center rounded-xl border border-border bg-surface-muted text-lg font-semibold text-neutral-strong transition hover:border-brand/40 hover:text-brand-deep active:cursor-grabbing"
          >
            <span aria-hidden="true">☰</span>
          </button>
        ) : null}

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">
            Information {index + 1}
          </p>
          <h2
            id={`information-card-title-${card.id}`}
            className="mt-2 break-words text-xl font-semibold tracking-[-0.025em] text-foreground sm:text-2xl"
          >
            {card.title}
          </h2>
        </div>

        {ownerControls ? (
          <details className="relative shrink-0">
            <summary
              aria-label={`Manage ${card.title}`}
              className="grid size-11 cursor-pointer list-none place-items-center rounded-xl border border-border bg-surface text-xl font-semibold leading-none text-neutral-strong transition hover:bg-surface-muted hover:text-brand-deep [&::-webkit-details-marker]:hidden"
            >
              <span aria-hidden="true">⋯</span>
            </summary>
            <div
              className="absolute right-0 z-20 mt-2 w-36 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-xl"
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  onEdit?.(card);
                }}
                className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm font-semibold text-foreground transition hover:bg-surface-muted"
              >
                Edit
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  onDelete?.(card);
                }}
                className="flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm font-semibold text-danger transition hover:bg-danger-subtle"
              >
                Delete
              </button>
            </div>
          </details>
        ) : null}
      </div>

      <div className={ownerControls ? "mt-6 sm:ml-[3.75rem]" : "mt-6"}>
        <div className="max-w-4xl">
          <OrganisationInformationContent content={card.content} />
        </div>
      </div>
    </article>
  );
}

function SortableInformationCard({
  card,
  index,
  disabled,
  onEdit,
  onDelete,
}: {
  card: OrganisationInformationCard;
  index: number;
  disabled: boolean;
  onEdit: (card: OrganisationInformationCard) => void;
  onDelete: (card: OrganisationInformationCard) => void;
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: card.id,
    index,
    disabled,
  });

  return (
    <div ref={ref}>
      <InformationCardArticle
        card={card}
        index={index}
        ownerControls
        dragHandleRef={handleRef}
        dragging={isDragging}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  );
}

function EditorToolbar({
  textareaRef,
  draft,
  setDraft,
  setMessage,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  setMessage: (result: InformationCardActionResult | null) => void;
}) {
  function restoreSelection(start: number, end: number) {
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start, end);
    });
  }

  function wrapSelection(before: string, after: string, placeholder: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = draft.content.slice(start, end) || placeholder;
    const content = `${draft.content.slice(0, start)}${before}${selected}${after}${draft.content.slice(end)}`;

    if ([...content].length > 20_000) {
      setMessage({ status: "error", message: "Content cannot exceed 20,000 characters." });
      return;
    }

    setMessage(null);
    setDraft((current) => ({ ...current, content }));
    restoreSelection(start + before.length, start + before.length + selected.length);
  }

  function prefixSelectedLines(kind: "heading" | "unordered" | "ordered") {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const blockStart = draft.content.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    const nextLineBreak = draft.content.indexOf("\n", selectionEnd);
    const blockEnd = nextLineBreak === -1 ? draft.content.length : nextLineBreak;
    const block = draft.content.slice(blockStart, blockEnd) || "Heading";
    const formatted = block
      .split("\n")
      .map((line, lineIndex) => {
        if (kind === "heading") return `## ${line.replace(/^#{1,6}\s+/, "")}`;
        if (kind === "ordered") return `${lineIndex + 1}. ${line.replace(/^\s*(?:[-*+] |\d+\. )/, "")}`;
        return `- ${line.replace(/^\s*(?:[-*+] |\d+\. )/, "")}`;
      })
      .join("\n");
    const content = `${draft.content.slice(0, blockStart)}${formatted}${draft.content.slice(blockEnd)}`;

    if ([...content].length > 20_000) {
      setMessage({ status: "error", message: "Content cannot exceed 20,000 characters." });
      return;
    }

    setMessage(null);
    setDraft((current) => ({ ...current, content }));
    restoreSelection(blockStart, blockStart + formatted.length);
  }

  function insertLink() {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const enteredUrl = window.prompt("Link URL", "https://");
    if (!enteredUrl) return;

    const url = /^[a-z][a-z\d+.-]*:/i.test(enteredUrl)
      ? enteredUrl.trim()
      : `https://${enteredUrl.trim()}`;

    try {
      const parsedUrl = new URL(url);
      if (!["http:", "https:", "mailto:"].includes(parsedUrl.protocol)) {
        throw new Error("Unsupported link protocol");
      }
    } catch {
      setMessage({
        status: "error",
        message: "Enter a valid http, https, or email link.",
      });
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const label = draft.content.slice(start, end) || "link text";
    const markdown = `[${label}](${url})`;
    const content = `${draft.content.slice(0, start)}${markdown}${draft.content.slice(end)}`;

    if ([...content].length > 20_000) {
      setMessage({ status: "error", message: "Content cannot exceed 20,000 characters." });
      return;
    }

    setMessage(null);
    setDraft((current) => ({ ...current, content }));
    restoreSelection(start + 1, start + 1 + label.length);
  }

  const toolbarButtonClass =
    "inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-neutral-strong transition hover:bg-brand-subtle hover:text-brand-deep";

  return (
    <div
      className="flex flex-wrap gap-2 rounded-t-xl border border-b-0 border-border bg-surface-muted p-2"
      role="toolbar"
      aria-label="Content formatting"
    >
      <button
        type="button"
        aria-label="Bold"
        title="Bold"
        onClick={() => wrapSelection("**", "**", "bold text")}
        className={toolbarButtonClass}
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        aria-label="Italic"
        title="Italic"
        onClick={() => wrapSelection("*", "*", "italic text")}
        className={toolbarButtonClass}
      >
        <em>I</em>
      </button>
      <button
        type="button"
        aria-label="Heading"
        title="Heading"
        onClick={() => prefixSelectedLines("heading")}
        className={toolbarButtonClass}
      >
        H
      </button>
      <button
        type="button"
        aria-label="Unordered list"
        title="Unordered list"
        onClick={() => prefixSelectedLines("unordered")}
        className={toolbarButtonClass}
      >
        • List
      </button>
      <button
        type="button"
        aria-label="Ordered list"
        title="Ordered list"
        onClick={() => prefixSelectedLines("ordered")}
        className={toolbarButtonClass}
      >
        1. List
      </button>
      <button
        type="button"
        aria-label="Insert link"
        title="Insert link"
        onClick={insertLink}
        className={toolbarButtonClass}
      >
        Link
      </button>
    </div>
  );
}

export function OrganisationInformationCards({
  organisation,
  initialCards,
  isOwner,
}: {
  organisation: Pick<Organisation, "id" | "name" | "slug">;
  initialCards: OrganisationInformationCard[];
  isOwner: boolean;
}) {
  const router = useRouter();
  const editorDialogRef = useRef<HTMLDialogElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [cards, setCards] = useState(initialCards);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [deleteCard, setDeleteCard] = useState<OrganisationInformationCard | null>(null);
  const [editorMessage, setEditorMessage] = useState<InformationCardActionResult | null>(null);
  const [pageMessage, setPageMessage] = useState<InformationCardActionResult | null>(null);
  const [orderMessage, setOrderMessage] = useState<InformationCardActionResult | null>(null);
  const [saving, startSaving] = useTransition();
  const [deleting, startDeleting] = useTransition();
  const [savingOrder, startSavingOrder] = useTransition();

  function openAddEditor() {
    setEditor({ mode: "add" });
    setDraft(emptyDraft);
    setEditorMessage(null);
    editorDialogRef.current?.showModal();
  }

  function openEditEditor(card: OrganisationInformationCard) {
    setEditor({ mode: "edit", card });
    setDraft({ title: card.title, content: card.content });
    setEditorMessage(null);
    editorDialogRef.current?.showModal();
  }

  function openDeleteDialog(card: OrganisationInformationCard) {
    setDeleteCard(card);
    deleteDialogRef.current?.showModal();
  }

  function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;

    setEditorMessage(null);
    startSaving(async () => {
      const sharedInput = {
        organisationId: organisation.id,
        organisationSlug: organisation.slug,
        title: draft.title,
        content: draft.content,
      };
      const result =
        editor.mode === "add"
          ? await createOrganisationInformationCard(sharedInput)
          : await updateOrganisationInformationCard({
              ...sharedInput,
              cardId: editor.card.id,
            });

      if (result.status === "error") {
        setEditorMessage(result);
        return;
      }

      editorDialogRef.current?.close();
      setEditor(null);
      setPageMessage(result);
      router.refresh();
    });
  }

  function confirmDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteCard) return;

    startDeleting(async () => {
      const result = await deleteOrganisationInformationCard({
        organisationId: organisation.id,
        organisationSlug: organisation.slug,
        cardId: deleteCard.id,
      });

      if (result.status === "error") {
        setPageMessage(result);
        deleteDialogRef.current?.close();
        return;
      }

      deleteDialogRef.current?.close();
      setDeleteCard(null);
      setPageMessage(result);
      router.refresh();
    });
  }

  const addDisabled = cards.length >= 5;

  return (
    <section aria-labelledby="organisation-information-heading">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="organisation-information-heading"
            className="text-lg font-semibold tracking-[-0.025em] text-foreground"
          >
            Information
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Published guidance and long-form information from {organisation.name}.
          </p>
        </div>

        {isOwner && cards.length > 0 ? (
          <div className="shrink-0 sm:text-right">
            <button
              type="button"
              disabled={addDisabled}
              onClick={openAddEditor}
              aria-label="Add information card"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-not-allowed disabled:opacity-55"
            >
              <span className="mr-2 text-base" aria-hidden="true">+</span>
              Add information card
            </button>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {cards.length} of 5 cards
              {addDisabled ? " · Maximum reached." : ""}
            </p>
          </div>
        ) : null}
      </div>

      {pageMessage ? (
        <div className="mb-5 rounded-xl border border-border bg-surface px-4 py-3">
          <ActionMessage result={pageMessage} />
        </div>
      ) : null}

      {cards.length === 0 && isOwner ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-xs">
          <div className="border-b border-border bg-surface-muted px-6 py-6 sm:px-8 sm:py-7">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">
              Get started
            </p>
            <h3 className="mt-2 text-xl font-semibold tracking-[-0.025em] text-foreground sm:text-2xl">
              Build your information page
            </h3>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Add up to 5 information cards for anything your shooters and clubs
              may need to know — such as league information, entry instructions,
              rules, or a privacy policy.
            </p>
          </div>

          <div className="p-6 sm:p-8">
            <ol className="grid gap-4 lg:grid-cols-3">
              <li className="min-w-0 rounded-xl border border-border bg-surface p-5">
                <span
                  className="grid size-10 place-items-center rounded-xl bg-brand-subtle text-lg font-semibold text-brand-deep"
                  aria-hidden="true"
                >
                  +
                </span>
                <h4 className="mt-4 font-semibold text-foreground">
                  1. Add a card
                </h4>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Give it any title and add the information you want to publish.
                </p>
              </li>
              <li className="min-w-0 rounded-xl border border-border bg-surface p-5">
                <span
                  className="grid size-10 place-items-center rounded-xl bg-brand-subtle text-sm font-bold text-brand-deep"
                  aria-hidden="true"
                >
                  B
                </span>
                <h4 className="mt-4 font-semibold text-foreground">
                  2. Format your content
                </h4>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Use headings, bold text, lists, and links to make longer
                  information easy to read.
                </p>
              </li>
              <li className="min-w-0 rounded-xl border border-border bg-surface p-5">
                <span
                  className="grid size-10 place-items-center rounded-xl bg-brand-subtle text-base font-semibold text-brand-deep"
                  aria-hidden="true"
                >
                  ☰
                </span>
                <h4 className="mt-4 font-semibold text-foreground">
                  3. Arrange your page
                </h4>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Drag cards into the order you want. The saved order becomes the
                  public order.
                </p>
              </li>
            </ol>

            <button
              type="button"
              onClick={openAddEditor}
              aria-label="Add your first information card"
              className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep sm:w-auto"
            >
              <span className="mr-2 text-base" aria-hidden="true">+</span>
              Add your first information card
            </button>
          </div>
        </div>
      ) : cards.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-xs sm:p-8">
          <div className="flex flex-col items-start gap-5 sm:flex-row">
            <span
              className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-subtle text-sm font-bold text-brand-deep"
              aria-hidden="true"
            >
              I
            </span>
            <div>
              <h3 className="font-semibold text-foreground">
                No information has been published yet
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                This organisation has not added any public information cards yet.
              </p>
            </div>
          </div>
        </div>
      ) : isOwner ? (
        <>
          <p className="sr-only" id="information-reorder-instructions">
            Use a card’s reorder button with a pointer, or press Space and then use
            the arrow keys to change its position.
          </p>
          <DragDropProvider
            onDragEnd={(event) => {
              if (event.canceled) return;

              const { source } = event.operation;
              if (!isSortable(source)) return;

              const { initialIndex, index } = source;
              if (initialIndex === index) return;

              const previousCards = cards;
              const nextCards = [...cards];
              const [movedCard] = nextCards.splice(initialIndex, 1);
              nextCards.splice(index, 0, movedCard);
              setCards(nextCards);
              setOrderMessage(null);

              startSavingOrder(async () => {
                const result = await reorderOrganisationInformationCards({
                  organisationId: organisation.id,
                  organisationSlug: organisation.slug,
                  cardIds: nextCards.map((card) => card.id),
                });

                if (result.status === "error") {
                  setCards(previousCards);
                } else {
                  router.refresh();
                }

                setOrderMessage(result);
              });
            }}
          >
            <div className="space-y-5">
              {cards.map((card, index) => (
                <SortableInformationCard
                  key={card.id}
                  card={card}
                  index={index}
                  disabled={savingOrder}
                  onEdit={openEditEditor}
                  onDelete={openDeleteDialog}
                />
              ))}
            </div>
          </DragDropProvider>
          <div className="mt-3 min-h-6 text-right">
            {savingOrder ? (
              <p className="text-xs text-muted-foreground" role="status">
                Saving order…
              </p>
            ) : orderMessage ? (
              <ActionMessage result={orderMessage} />
            ) : null}
          </div>
        </>
      ) : (
        <div className="space-y-5">
          {cards.map((card, index) => (
            <InformationCardArticle
              key={card.id}
              card={card}
              index={index}
              ownerControls={false}
            />
          ))}
        </div>
      )}

      <dialog
        ref={editorDialogRef}
        aria-labelledby="information-card-editor-title"
        onCancel={(event) => {
          if (saving) event.preventDefault();
        }}
        onClose={() => {
          if (!saving) {
            setEditor(null);
            setEditorMessage(null);
          }
        }}
        className="m-auto max-h-[92vh] w-[min(94vw,48rem)] overflow-y-auto rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-hero-background/70 backdrop:backdrop-blur-sm"
      >
        <form onSubmit={submitEditor} className="p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">
            Organisation information
          </p>
          <h2
            id="information-card-editor-title"
            className="mt-2 text-xl font-semibold tracking-[-0.025em]"
          >
            {editor?.mode === "edit" ? "Edit information card" : "Add information card"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Use the formatting toolbar for headings, emphasis, lists, and safe links.
          </p>

          <div className="mt-6">
            <label htmlFor="information-card-title" className="text-sm font-semibold text-foreground">
              Title
            </label>
            <input
              id="information-card-title"
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              maxLength={120}
              required
              autoFocus
              disabled={saving}
              className="mt-2 min-h-11 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-brand"
            />
            <p className="mt-1.5 text-right text-xs text-muted-foreground">
              {[...draft.title].length}/120
            </p>
          </div>

          <div className="mt-4">
            <label htmlFor="information-card-content" className="text-sm font-semibold text-foreground">
              Content
            </label>
            <div className="mt-2">
              <EditorToolbar
                textareaRef={textareaRef}
                draft={draft}
                setDraft={setDraft}
                setMessage={setEditorMessage}
              />
              <textarea
                ref={textareaRef}
                id="information-card-content"
                value={draft.content}
                onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
                maxLength={20_000}
                required
                disabled={saving}
                rows={14}
                className="min-h-72 w-full resize-y rounded-b-xl border border-border bg-surface px-4 py-3 text-sm leading-6 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-brand"
                placeholder="Write the information this organisation wants to publish…"
              />
            </div>
            <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>Raw HTML and embedded content are not supported.</span>
              <span>{[...draft.content].length.toLocaleString()}/20,000</span>
            </div>
          </div>

          <div className="mt-4 min-h-6">
            <ActionMessage result={editorMessage} />
          </div>

          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={saving}
              onClick={() => editorDialogRef.current?.close()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold transition hover:bg-surface-muted disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-wait disabled:opacity-60"
            >
              {saving
                ? "Saving…"
                : editor?.mode === "edit"
                  ? "Save changes"
                  : "Add card"}
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={deleteDialogRef}
        aria-labelledby="delete-information-card-title"
        aria-describedby="delete-information-card-description"
        onCancel={(event) => {
          if (deleting) event.preventDefault();
        }}
        className="m-auto w-[min(92vw,32rem)] rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-hero-background/70 backdrop:backdrop-blur-sm"
      >
        <form onSubmit={confirmDelete} className="p-6 sm:p-7">
          <h2 id="delete-information-card-title" className="break-words text-lg font-semibold">
            Delete “{deleteCard?.title}”?
          </h2>
          <p
            id="delete-information-card-description"
            className="mt-3 text-sm leading-6 text-muted-foreground"
          >
            This published information will be removed from the organisation page.
          </p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={deleting}
              onClick={() => deleteDialogRef.current?.close()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold transition hover:bg-surface-muted disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={deleting}
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-danger px-5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-wait disabled:opacity-60"
            >
              {deleting ? "Deleting…" : "Delete card"}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
