import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(
  request: NextRequest,
  publicResultsRoute = false,
) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    "x-rifleleagues-public-results",
    publicResultsRoute ? "1" : "0",
  );
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );

          response = NextResponse.next({ request: { headers: requestHeaders } });

          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([name, value]) =>
            response.headers.set(name, value),
          );
        },
      },
    },
  );

  // This validates the access token and refreshes it when necessary. Keep this
  // immediately after client creation so refreshed cookies reach the response.
  await supabase.auth.getClaims();

  return response;
}
