import { toNextHandler } from "@rivetkit/next-js";
import { registry } from "@/rivet/registry";
import { guardRivetRequest } from "@/rivet/request-guard";

export const runtime = "nodejs";
export const maxDuration = 300;

const handlers = toNextHandler(registry);

type RouteContext = {
  params: Promise<{ all: string[] }>;
};

function wrap(
  method: keyof typeof handlers,
): (request: Request, context: RouteContext) => Promise<Response> {
  return async (request, context) => {
    const { all } = await context.params;
    return guardRivetRequest(
      request,
      all,
      () => handlers[method](request, {
        params: Promise.resolve({ all }),
      }),
      {
        expectedStartToken: configuredRivetToken(),
        requireStartToken: process.env.NODE_ENV === "production",
      },
    );
  };
}

function configuredRivetToken(): string | undefined {
  try {
    return registry.parseConfig().token;
  } catch {
    return undefined;
  }
}

export const GET = wrap("GET");
export const POST = wrap("POST");
export const PUT = wrap("PUT");
export const DELETE = wrap("DELETE");
export const PATCH = wrap("PATCH");
export const HEAD = wrap("HEAD");
export const OPTIONS = wrap("OPTIONS");
