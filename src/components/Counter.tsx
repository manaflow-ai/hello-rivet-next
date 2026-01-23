"use client";

import { createRivetKit } from "@rivetkit/next-js/client";
import type { registry } from "@/rivet/registry";
import { useState } from "react";

export const { useActor } = createRivetKit<typeof registry>(
    process.env.NEXT_PUBLIC_RIVET_ENDPOINT ?? "http://localhost:4242/api/rivet",
);

export function Counter() {
    const [count, setCount] = useState(0);

    // Get or create a counter actor for the key "my-counter"
    const counter = useActor({
        name: "counter",
        key: ["my-counter"]
    });

    // Listen to realtime events
    counter.useEvent("newCount", (x: number) => setCount(x));

    const increment = async () => {
        // Call actions
        await counter.connection?.increment(1);
    };

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
