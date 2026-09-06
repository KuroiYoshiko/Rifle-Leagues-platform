import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { isPublicResultsPathname } from "@/lib/public-results-routes.mjs";

export async function proxy(request: NextRequest) {
  return updateSession(
    request,
    isPublicResultsPathname(request.nextUrl.pathname),
  );
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
