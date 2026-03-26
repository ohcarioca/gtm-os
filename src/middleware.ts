import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import "@/lib/env"; // validate env vars at startup

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
