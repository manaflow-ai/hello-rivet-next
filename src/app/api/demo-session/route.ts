import { NextResponse } from "next/server";
import {
  getSessionCookieToken,
  issueDemoSession,
  sessionCookieOptions,
  verifyDemoSession,
} from "@/rivet/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  try {
    const existingToken = getSessionCookieToken(request);
    let session = existingToken ? verifySafely(existingToken) : null;
    const shouldSetCookie = !session;

    if (!session) session = issueDemoSession();

    const response = NextResponse.json(
      {
        sessionId: session.id,
        sessionToken: session.token,
        expiresAt: session.expiresAt,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );

    if (shouldSetCookie) response.cookies.set(sessionCookieOptions(session));
    return response;
  } catch {
    return NextResponse.json(
      { error: "Demo authentication is not configured." },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
}

function verifySafely(token: string) {
  try {
    return verifyDemoSession(token);
  } catch {
    return null;
  }
}
