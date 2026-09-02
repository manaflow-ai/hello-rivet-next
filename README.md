# hello-rivet-next

A small Next.js and RivetKit counter example.

## Security contract

The browser receives a signed, short-lived demo session from
`/api/demo-session`. The session token is used as Rivet connection data, and
the actor key is bound to the session ID. Requests without a valid signature,
or requests that try to use another session's actor, are rejected.

The counter accepts only positive safe integers from `1` through `10`. Each
session can make at most 30 increments per minute, and the counter stops at
1,000,000. The Next.js route rejects request bodies larger than 16 KiB and
allows at most 120 protected requests per minute per session in one server
process. Anonymous session creation allows 10 requests per minute for each
Vercel-provided client IP and 100 requests per minute across one server
process. Non-Vercel deployments use one shared requester bucket because client
forwarding headers are not trusted by default.

Set `RIVET_DEMO_SESSION_SECRET` to a random value with at least 32 characters
in every deployed environment. For example:

```sh
openssl rand -base64 32
```

Every environment outside explicitly opted-in local development fails closed
when this variable is missing or too short. To run the example locally without
creating a secret, set `RIVET_DEMO_ALLOW_INSECURE_LOCAL=1`; this fallback is
accepted only with `NODE_ENV=development` and is disabled on Vercel. Tests
inject a separate secret. The
`/api/rivet/start` control-plane callback also fails closed in production
unless `RIVET_ENDPOINT` includes a backend token or `RIVET_TOKEN` is set.

Rivet Cloud can redirect browser manager requests from the Next.js route to
its public endpoint. The actor's `onBeforeConnect` and `createConnState` hooks
therefore verify the signed session again and bind it to the actor key. The
Next.js request limiters are process-local, and Rivet's publishable token and
control plane remain separate trust boundaries. Configure a platform rate
limit for `/api/demo-session` and use a real identity provider before using
this example as an application backend. On Vercel, the firewall can enforce a
distributed IP limit before a request reaches this route.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
