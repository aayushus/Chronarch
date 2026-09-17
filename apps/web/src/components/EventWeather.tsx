import React, { useEffect, useState } from "react";

import { weatherForEvent } from "../api/weather";

/** Fail-silent weather chip for agenda rows: renders nothing until the
 * forecast resolves (or ever, when the location can't be geocoded). */
export default function EventWeather({ location, start, color }: { location: string | null; start: string; color?: string }) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setText(null);
    if (!location) return;
    void weatherForEvent(location, start).then((t) => {
      if (live) setText(t);
    });
    return () => {
      live = false;
    };
  }, [location, start]);

  if (!text) return null;
  return <span style={{ color: color ?? "var(--text-secondary)" }}> · {text}</span>;
}
