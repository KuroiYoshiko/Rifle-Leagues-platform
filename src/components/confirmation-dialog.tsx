"use client";

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";

export function ConfirmationDialog({
  open,
  title,
  description,
  children,
  onCancel,
  cancelDisabled = false,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  children: ReactNode;
  onCancel: () => void;
  cancelDisabled?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      dialog.showModal();
      const firstButton = dialog.querySelector<HTMLElement>("button:not([disabled])");
      firstButton?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!cancelDisabled) onCancel();
      }}
      onClose={() => returnFocusRef.current?.focus()}
      className="m-auto w-[min(92vw,32rem)] rounded-2xl border border-border bg-surface p-0 text-left text-foreground shadow-2xl backdrop:bg-hero-background/70 backdrop:backdrop-blur-sm"
    >
      <div className="p-6 sm:p-7">
        <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
        <div id={descriptionId} className="mt-3 text-sm leading-6 text-muted-foreground">
          {description}
        </div>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {children}
        </div>
      </div>
    </dialog>
  );
}
