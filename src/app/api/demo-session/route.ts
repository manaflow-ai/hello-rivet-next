import { NextResponse } from "next/server";
import {
  consumeDemoSessionIssueLimit,
  demoSessionGlobalLimiter,
  demoSessionIssuerLimiter,
  FixedWindowRateLimiter,
  getSessionCookieToken,
  issueDemoSession,
  sessionCookieOptions,
  verifyDemoSession,
} from "@/rivet/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DemoSessionHandlerOptions {
  issuerLimiter?: FixedWindowRateLimiter;
  globalLimiter?: FixedWindowRateLimiter;
  trustProxyHeaders?: boolean;
}

export function createDemoSessionHandler(
  options: DemoSessionHandlerOptions = {},
) {
  return (request: Request): Response => handleRequest(request, options);
}

export const GET = createDemoSessionHandler({
  issuerLimiter: demoSessionIssuerLimiter,
  globalLimiter: demoSessionGlobalLimiter,
});

function handleRequest(
  request: Request,
  options: DemoSessionHandlerOptions,
): Response {
  try {
    const existingToken = getSessionCookieToken(request);
    let session = existingToken ? verifySafely(existingToken) : null;
    const shouldSetCookie = !session;

    if (!session) {
      const limit = consumeDemoSessionIssueLimit(request, options);
      if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);
      session = issueDemoSession();
    }

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

function rateLimitedResponse(retryAfterSeconds: number): Response {
  return NextResponse.json(
    { error: "Too many demo sessions. Try again later." },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSeconds),
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function verifySafely(token: string) {
  try {
    return verifyDemoSession(token);
  } catch {
    return null;
  }
}
