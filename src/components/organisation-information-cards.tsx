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
} from "@/app/(app)/organisations/[slug]/information/actions";
import { OrganisationInformationContent } from "@/components/organisation-information-content";
import { OrganisationRichTextEditor } from "@/components/organisation-rich-text-editor";
import type { Organisation, OrganisationInformationCard } from "@/lib/organisations";

export type InformationCardActionResult = {
  status: "success" | "error";
  message: string;
};

export type InformationCard = {
  id: number;
  title: string;
  content: string;
  position: number;
  updated_at: string;
};

type InformationEntity = {
  id: number;
  name: string;
  slug: string;
};

type MutationInput = {
  entityId: number;
  entitySlug: string;
  title: string;
  content: string;
};

type InformationCardActions = {
  create: (input: MutationInput) => Promise<InformationCardActionResult>;
  update: (input: MutationInput & { cardId: number }) => Promise<InformationCardActionResult>;
  delete: (input: Pick<MutationInput, "entityId" | "entitySlug"> & { cardId: number }) => Promise<InformationCardActionResult>;
  reorder: (input: Pick<MutationInput, "entityId" | "entitySlug"> & { cardIds: number[] }) => Promise<InformationCardActionResult>;
};

export type InformationCardsCopy = {
  headingId: string;
  description: string;
  editorEyebrow: string;
  onboardingTitle: string;
  onboardingDescription: string;
  emptyTitle: string;
  emptyDescription: string;
  deleteDescription: string;
};

type EditorState =
  | { mode: "add" }
  | { mode: "edit"; card: InformationCard };

type Draft = { title: string; content: string; contentLength: number };

const emptyDraft: Draft = { title: "", content: "", contentLength: 0 };

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
  ownerControls,
  dragHandleRef,
  dragging = false,
  onEdit,
  onDelete,
}: {
  card: InformationCard;
  ownerControls: boolean;
  dragHandleRef?: (element: Element | null) => void;
  dragging?: boolean;
  onEdit?: (card: InformationCard) => void;
  onDelete?: (card: InformationCard) => void;
}) {
  return (
    <article
      className={`relative min-w-0 rounded-2xl border bg-surface p-6 shadow-xs transition sm:p-8 ${
        dragging
          ? "border-brand/60 opacity-80 shadow-lg"
          : "border-border"
      }`}
      aria-labelledby={`information-card-title-${card.id}`}
    >
      {ownerControls ? (
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1 sm:right-5 sm:top-5">
          <button
            ref={dragHandleRef}
            type="button"
            aria-label={`Drag to reorder ${card.title}`}
            aria-describedby="information-reorder-instructions"
            title="Drag to reorder"
            className="inline-flex size-11 shrink-0 touch-none cursor-grab items-center justify-center rounded-xl border border-transparent bg-transparent text-lg font-semibold text-neutral-strong transition hover:bg-surface-muted hover:text-brand-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:cursor-grabbing active:bg-brand-subtle"
          >
            <span aria-hidden="true">☰</span>
          </button>
          <details className="relative shrink-0">
            <summary
              aria-label={`Manage ${card.title}`}
              className="grid size-11 cursor-pointer list-none place-items-center rounded-xl border border-transparent bg-transparent text-xl font-semibold leading-none text-neutral-strong transition hover:bg-surface-muted hover:text-brand-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand [&::-webkit-details-marker]:hidden"
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
        </div>
      ) : null}

      <h2
        id={`information-card-title-${card.id}`}
        className={`break-words text-xl font-bold uppercase leading-7 tracking-[0.09em] text-brand-strong sm:text-[1.375rem] sm:leading-8 ${
          ownerControls ? "pr-24" : ""
        }`}
      >
        {card.title}
      </h2>

      <div className="mt-6">
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
  card: InformationCard;
  index: number;
  disabled: boolean;
  onEdit: (card: InformationCard) => void;
  onDelete: (card: InformationCard) => void;
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
        ownerControls
        dragHandleRef={handleRef}
        dragging={isDragging}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  );
}

export function InformationCards({
  entity,
  initialCards,
  isOwner,
  actions,
  copy,
}: {
  entity: InformationEntity;
  initialCards: InformationCard[];
  isOwner: boolean;
  actions: InformationCardActions;
  copy: InformationCardsCopy;
}) {
  const router = useRouter();
  const editorDialogRef = useRef<HTMLDialogElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const [cards, setCards] = useState(initialCards);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [deleteCard, setDeleteCard] = useState<InformationCard | null>(null);
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

  function openEditEditor(card: InformationCard) {
    setEditor({ mode: "edit", card });
    setDraft({
      title: card.title,
      content: card.content,
      contentLength: card.content.length,
    });
    setEditorMessage(null);
    editorDialogRef.current?.showModal();
  }

  function openDeleteDialog(card: InformationCard) {
    setDeleteCard(card);
    deleteDialogRef.current?.showModal();
  }

  function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;

    if (draft.contentLength < 1) {
      setEditorMessage({
        status: "error",
        message: "Add some content before saving this card.",
      });
      return;
    }

    if (draft.contentLength > 20_000 || [...draft.content].length > 20_000) {
      setEditorMessage({
        status: "error",
        message: "Content cannot exceed 20,000 characters.",
      });
      return;
    }

    setEditorMessage(null);
    startSaving(async () => {
      const sharedInput = {
        entityId: entity.id,
        entitySlug: entity.slug,
        title: draft.title,
        content: draft.content,
      };
      const result =
        editor.mode === "add"
          ? await actions.create(sharedInput)
          : await actions.update({
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
      const result = await actions.delete({
        entityId: entity.id,
        entitySlug: entity.slug,
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
    <section aria-labelledby={copy.headingId}>
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id={copy.headingId}
            className="text-lg font-semibold tracking-[-0.025em] text-foreground"
          >
            Information
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {copy.description}
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

      {isOwner && cards.length > 0 ? (
        <div className="mb-5 flex min-w-0 items-start gap-3 rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm leading-6 text-muted-foreground">
          <span
            className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand-subtle text-xs font-bold text-brand-deep"
            aria-hidden="true"
          >
            i
          </span>
          <p>
            {cards.length === 1 ? (
              <>
                <span className="font-semibold text-neutral-strong">Tip:</span>{" "}
                You can add up to 5 cards and format their content. Add more cards
                to arrange the page using drag and drop.
              </>
            ) : (
              <>
                <span className="font-semibold text-neutral-strong">Tip:</span>{" "}
                Drag cards to reorder them. Use ⋯ to edit or delete.
                {cards.length === 5
                  ? " Maximum of 5 information cards reached."
                  : ""}
              </>
            )}
          </p>
        </div>
      ) : null}

      {cards.length === 0 && isOwner ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-xs">
          <div className="border-b border-border bg-surface-muted px-6 py-6 sm:px-8 sm:py-7">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">
              Get started
            </p>
            <h3 className="mt-2 text-xl font-semibold tracking-[-0.025em] text-foreground sm:text-2xl">
              {copy.onboardingTitle}
            </h3>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              {copy.onboardingDescription}
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
                {copy.emptyTitle}
              </h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {copy.emptyDescription}
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
                const result = await actions.reorder({
                  entityId: entity.id,
                  entitySlug: entity.slug,
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
          {cards.map((card) => (
            <InformationCardArticle
              key={card.id}
              card={card}
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
            {copy.editorEyebrow}
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
              {editor ? (
                <OrganisationRichTextEditor
                  key={editor.mode === "edit" ? editor.card.id : "new-card"}
                  disabled={saving}
                  initialMarkdown={draft.content}
                  onChange={({ markdown, textLength }) => {
                    setDraft((current) => ({
                      ...current,
                      content: markdown,
                      contentLength: textLength,
                    }));
                    if (textLength > 20_000 || [...markdown].length > 20_000) {
                      setEditorMessage({
                        status: "error",
                        message: "Content cannot exceed 20,000 characters.",
                      });
                    } else {
                      setEditorMessage(null);
                    }
                  }}
                  onMessage={(message) =>
                    setEditorMessage(
                      message ? { status: "error", message } : null,
                    )
                  }
                />
              ) : null}
            </div>
            <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span id="information-card-content-help">
                Paste or type normally. Raw HTML and embedded content are not supported.
              </span>
              <span
                id="information-card-content-count"
                className={draft.contentLength > 20_000 ? "text-danger" : undefined}
              >
                {draft.contentLength.toLocaleString()}/20,000
              </span>
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
              disabled={
                saving ||
                draft.contentLength > 20_000 ||
                [...draft.content].length > 20_000
              }
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
            {copy.deleteDescription}
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

export function OrganisationInformationCards({
  organisation,
  initialCards,
  isOwner,
}: {
  organisation: Pick<Organisation, "id" | "name" | "slug">;
  initialCards: OrganisationInformationCard[];
  isOwner: boolean;
}) {
  return (
    <InformationCards
      entity={organisation}
      initialCards={initialCards}
      isOwner={isOwner}
      copy={{
        headingId: "organisation-information-heading",
        description: `Published guidance and long-form information from ${organisation.name}.`,
        editorEyebrow: "Organisation information",
        onboardingTitle: "Build your information page",
        onboardingDescription:
          "Add up to 5 information cards for anything your shooters and clubs may need to know — such as league information, entry instructions, rules, or a privacy policy.",
        emptyTitle: "No information has been published yet",
        emptyDescription:
          "This organisation has not added any public information cards yet.",
        deleteDescription:
          "This published information will be removed from the organisation page.",
      }}
      actions={{
        create: ({ entityId, entitySlug, title, content }) =>
          createOrganisationInformationCard({
            organisationId: entityId,
            organisationSlug: entitySlug,
            title,
            content,
          }),
        update: ({ entityId, entitySlug, cardId, title, content }) =>
          updateOrganisationInformationCard({
            organisationId: entityId,
            organisationSlug: entitySlug,
            cardId,
            title,
            content,
          }),
        delete: ({ entityId, entitySlug, cardId }) =>
          deleteOrganisationInformationCard({
            organisationId: entityId,
            organisationSlug: entitySlug,
            cardId,
          }),
        reorder: ({ entityId, entitySlug, cardIds }) =>
          reorderOrganisationInformationCards({
            organisationId: entityId,
            organisationSlug: entitySlug,
            cardIds,
          }),
      }}
    />
  );
}
