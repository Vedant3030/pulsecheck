"use client";

import { useEffect, useState } from "react";

/** ICU header clock — ticks every second. */
export function LiveClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const formatted = now.toLocaleTimeString("en-US", { hour12: false });

  return (
    <div className="text-right">
      <p className="text-[10px] tracking-[0.2em] text-phosphor-dim uppercase">
        Local time
      </p>
      <time
        dateTime={now.toISOString()}
        className="live-clock text-2xl font-bold tracking-widest text-phosphor tabular-nums"
      >
        {formatted}
      </time>
    </div>
  );
}
