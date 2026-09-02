"use client";

import { createRivetKit } from "@rivetkit/next-js/client";
import type { registry } from "@/rivet/registry";
import { useEffect, useState } from "react";
import {
    DemoSessionCache,
    loadDemoSession,
    sessionRefreshDelay,
    type DemoSession,
} from "./demo-session";

export const { useActor } = createRivetKit<typeof registry>(
    process.env.NEXT_PUBLIC_RIVET_ENDPOINT,
);

const demoSessionCache = new DemoSessionCache(loadDemoSession);
const SESSION_RETRY_DELAY_MS = 5_000;

export function Counter() {
    const [count, setCount] = useState(0);
    const [session, setSession] = useState<DemoSession | null>(null);
    const [sessionError, setSessionError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        let refreshTimer: ReturnType<typeof setTimeout> | undefined;

        const scheduleRefresh = (delay: number) => {
            refreshTimer = setTimeout(refresh, delay);
        };

        const refresh = () => {
            void demoSessionCache
                .get()
                .then((nextSession) => {
                    if (!active) return;
                    setSessionError(null);
                    setSession(nextSession);
                    scheduleRefresh(sessionRefreshDelay(nextSession));
                })
                .catch(() => {
                    if (!active) return;
                    setSessionError("Unable to start the demo session.");
                    scheduleRefresh(SESSION_RETRY_DELAY_MS);
                });
        };

        refresh();
        return () => {
            active = false;
            if (refreshTimer) clearTimeout(refreshTimer);
        };
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
