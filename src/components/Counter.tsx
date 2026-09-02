"use client";

import { createRivetKit } from "@rivetkit/next-js/client";
import type { registry } from "@/rivet/registry";
import { useEffect, useState } from "react";

export const { useActor } = createRivetKit<typeof registry>(
    process.env.NEXT_PUBLIC_RIVET_ENDPOINT,
);

interface DemoSession {
    sessionId: string;
    sessionToken: string;
}

let sessionRequest: Promise<DemoSession> | undefined;

export function Counter() {
    const [count, setCount] = useState(0);
    const [session, setSession] = useState<DemoSession | null>(null);
    const [sessionError, setSessionError] = useState<string | null>(null);

    useEffect(() => {
        if (!sessionRequest) sessionRequest = loadDemoSession();

        sessionRequest
            .then(setSession)
            .catch(() => {
                sessionRequest = undefined;
                setSessionError("Unable to start the demo session.");
            });
    }, []);

    const counter = useActor({
        name: "counter",
        key: [session?.sessionId ?? "pending"],
        params: session ? { sessionToken: session.sessionToken } : undefined,
        enabled: session !== null,
    });

    counter.useEvent("newCount", (x: number) => setCount(x));

    const increment = async () => {
        if (counter.connection) await counter.connection.increment(1);
    };

    if (sessionError) return <p>{sessionError}</p>;
    if (!session) return <p>Starting a private demo session...</p>;

    return (
        <div className="flex flex-col items-center gap-4 p-8">
            <p className="text-2xl font-bold">Count: {count}</p>
            <button
                onClick={increment}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition"
            >
                Increment
            </button>
        </div>
    );
}

async function loadDemoSession(): Promise<DemoSession> {
    const response = await fetch("/api/demo-session", {
        credentials: "same-origin",
        cache: "no-store",
    });
    if (!response.ok) throw new Error("demo session request failed");

    const value: unknown = await response.json();
    if (!isDemoSession(value)) throw new Error("invalid demo session response");
    return value;
}

function isDemoSession(value: unknown): value is DemoSession {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }

    const record = value as Record<string, unknown>;
    return (
        typeof record.sessionId === "string" &&
        typeof record.sessionToken === "string" &&
        record.sessionId.length > 0 &&
        record.sessionToken.length > 0
    );
}
