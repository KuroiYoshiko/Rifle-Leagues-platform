"use client";

import Link from "next/link";
import { useState, type MouseEvent, type ReactNode } from "react";

export function DashboardLink({ children, className, prefetch = false }: {
  children: ReactNode;
  className: string;
  prefetch?: boolean;
}) {
  const [pending, setPending] = useState(false);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (pending) {
      event.preventDefault();
      return;
    }
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      setPending(true);
    }
  }

  return <Link href="/dashboard" prefetch={prefetch} onClick={handleClick}
    aria-busy={pending} aria-disabled={pending}
    className={className}>
    <span aria-live="polite">{pending ? "Opening…" : children}</span>
  </Link>;
}
