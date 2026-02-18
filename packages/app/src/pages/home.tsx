import { createEffect, createSignal } from "solid-js";
import { Button } from "@steve/ui/button";
import { Card } from "@steve/ui/card";

export default function Home() {
  const [count, setCount] = createSignal(0);
  const [theme, setTheme] = createSignal<"dark" | "light">("dark");
  const [font, setFont] = createSignal<"sans" | "mono">("sans");
  const [compact, setCompact] = createSignal(false);

  createEffect(() => {
    document.documentElement.dataset.theme = theme();
  });

  createEffect(() => {
    document.documentElement.dataset.font = font();
  });

  return (
    <div style={{ display: "grid", gap: "16px" }}>
      <Card>
        <h1 style={{ margin: "0 0 8px 0" }}>Styling Architecture Demo</h1>
        <p style={{ margin: "0 0 16px 0" }}>
          This page exercises color mapping, semantic tokens, layered CSS, data
          selectors, and the font/theme toggles.
        </p>

        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "8px" }}>
          <Button
            variant="secondary"
            compact={compact()}
            onClick={() => setTheme(theme() === "light" ? "dark" : "light")}
          >
            Theme: {theme()}
          </Button>
          <Button
            variant="secondary"
            compact={compact()}
            onClick={() => setFont(font() === "sans" ? "mono" : "sans")}
          >
            Font: {font()}
          </Button>
          <Button
            variant="secondary"
            compact={compact()}
            onClick={() => setCompact(!compact())}
          >
            Compact: {compact() ? "on" : "off"}
          </Button>
        </div>
      </Card>

      <Card>
        <h2 style={{ margin: "0 0 8px 0" }}>
          Button Component (data selectors)
        </h2>
        <div style={{ display: "flex", "flex-wrap": "wrap", gap: "8px" }}>
          <Button
            variant="primary"
            size={compact() ? "small" : "normal"}
            onClick={() => setCount(count() + 1)}
          >
            Increment
          </Button>
          <Button
            variant="secondary"
            size={compact() ? "small" : "normal"}
            onClick={() => setCount(count() - 1)}
          >
            Decrement
          </Button>
          <Button size="large" disabled>
            Disabled
          </Button>
        </div>
        <p
          style={{
            margin: "12px 0 0 0",
            "font-family": "var(--font-family-mono)",
          }}
        >
          Count: {count()}
        </p>
      </Card>

      <div
        style={{
          display: "grid",
          gap: "12px",
          "grid-template-columns": "repeat(auto-fit, minmax(220px, 1fr))",
        }}
      >
        <Card tone="success">Semantic tone: success</Card>
        <Card tone="warning">Semantic tone: warning</Card>
        <Card tone="error">Semantic tone: error</Card>
      </div>

      <section class="grid gap-3 rounded-xl border border-border-base bg-background-raised p-4 md:grid-cols-2">
        <div>
          <h2 class="font-sans text-lg text-text-strong">Tailwind example</h2>
          <p class="mt-2 text-text-base">
            This block is styled with Tailwind classes that read from your
            semantic token mapping.
          </p>
        </div>
        <div class="flex items-start gap-2 md:justify-end">
          <span class="rounded-md bg-surface-muted px-2 py-1 font-mono text-sm text-text-base">
            bg-surface-muted
          </span>
          <span class="rounded-md bg-accent px-2 py-1 font-mono text-sm text-white">
            bg-accent
          </span>
        </div>
      </section>
    </div>
  );
}
