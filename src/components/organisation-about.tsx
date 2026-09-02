"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState, useTransition } from "react";
import {
  updateOrganisationAbout,
  type OrganisationContentActionResult,
} from "@/app/(app)/organisations/[slug]/actions";
import { OrganisationInformationContent } from "@/components/organisation-information-content";
import { OrganisationRichTextEditor } from "@/components/organisation-rich-text-editor";
import { Card } from "@/components/ui";

const contentLimit = 20_000;

function ActionMessage({ result }: { result: OrganisationContentActionResult | null }) {
  if (!result) return null;

  return (
    <p
      className={result.status === "error" ? "text-sm text-danger" : "text-sm text-success"}
      role={result.status === "error" ? "alert" : "status"}
    >
      {result.message}
    </p>
  );
}

export function OrganisationAbout({
  organisationId,
  initialContent,
  isOwner,
}: {
  organisationId: number;
  initialContent: string | null;
  isOwner: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(initialContent ?? "");
  const [contentLength, setContentLength] = useState(initialContent?.length ?? 0);
  const [editorKey, setEditorKey] = useState(0);
  const [editorMessage, setEditorMessage] =
    useState<OrganisationContentActionResult | null>(null);
  const [pageMessage, setPageMessage] =
    useState<OrganisationContentActionResult | null>(null);
  const [saving, startSaving] = useTransition();

  function openEditor() {
    setDraft(initialContent ?? "");
    setContentLength(initialContent?.length ?? 0);
    setEditorMessage(null);
    setEditorKey((current) => current + 1);
    dialogRef.current?.showModal();
  }

  function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (contentLength > contentLimit || [...draft].length > contentLimit) {
      setEditorMessage({
        status: "error",
        message: "About content cannot exceed 20,000 characters.",
      });
      return;
    }

    setEditorMessage(null);
    startSaving(async () => {
      const result = await updateOrganisationAbout({
        organisationId,
        content: draft,
      });

      if (result.status === "error") {
        setEditorMessage(result);
        return;
      }

      dialogRef.current?.close();
      setPageMessage(result);
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="organisation-about-heading">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2
            id="organisation-about-heading"
            className="text-lg font-semibold tracking-[-0.025em] text-foreground"
          >
            About
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Public introduction supplied by this organisation.
          </p>
        </div>
        {isOwner ? (
          <button
            type="button"
            onClick={openEditor}
            className="inline-flex min-h-11 shrink-0 items-center justify-center self-start rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-brand-deep transition hover:bg-brand-subtle sm:self-auto"
          >
            {initialContent ? "Edit About" : "Add About information"}
          </button>
        ) : null}
      </div>

      {pageMessage ? (
        <div className="mb-5 rounded-xl border border-border bg-surface px-4 py-3">
          <ActionMessage result={pageMessage} />
        </div>
      ) : null}

      <Card className="min-w-0 p-6 sm:p-8">
        {initialContent ? (
          <OrganisationInformationContent content={initialContent} />
        ) : (
          <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
            No organisation introduction has been published yet.
          </p>
        )}
      </Card>

      <dialog
        ref={dialogRef}
        aria-labelledby="about-editor-title"
        onCancel={(event) => {
          if (saving) event.preventDefault();
        }}
        className="m-auto max-h-[92vh] w-[min(94vw,48rem)] overflow-y-auto rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-hero-background/70 backdrop:backdrop-blur-sm"
      >
        <form onSubmit={submitEditor} className="p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">
            Organisation overview
          </p>
          <h2
            id="about-editor-title"
            className="mt-2 text-xl font-semibold tracking-[-0.025em]"
          >
            {initialContent ? "Edit About information" : "Add About information"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Use the formatting toolbar for headings, emphasis, lists, and safe links.
          </p>

          <div className="mt-6">
            <label htmlFor="organisation-about-content" className="text-sm font-semibold text-foreground">
              About content
            </label>
            <div className="mt-2">
              <OrganisationRichTextEditor
                key={editorKey}
                disabled={saving}
                initialMarkdown={draft}
                editorId="organisation-about-content"
                ariaLabel="About content"
                describedBy="organisation-about-content-help organisation-about-content-count"
                placeholder="Write an introduction to this organisation…"
                onChange={({ markdown, textLength }) => {
                  setDraft(markdown);
                  setContentLength(textLength);
                  if (textLength > contentLimit || [...markdown].length > contentLimit) {
                    setEditorMessage({
                      status: "error",
                      message: "About content cannot exceed 20,000 characters.",
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
            </div>
            <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span id="organisation-about-content-help">
                Paste or type normally. Raw HTML and embedded content are not supported.
              </span>
              <span
                id="organisation-about-content-count"
                className={contentLength > contentLimit ? "text-danger" : undefined}
              >
                {contentLength.toLocaleString()}/20,000
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
              onClick={() => dialogRef.current?.close()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold transition hover:bg-surface-muted disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                saving ||
                contentLength > contentLimit ||
                [...draft].length > contentLimit
              }
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-brand-deep disabled:cursor-wait disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
