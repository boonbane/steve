import type { JSX } from "solid-js";

type ButtonProps = {
  variant?: "primary" | "secondary";
  size?: "small" | "normal" | "large";
  compact?: boolean;
} & JSX.ButtonHTMLAttributes<HTMLButtonElement>;

export function Button(props: ButtonProps) {
  const size = () => {
    if (props.size) return props.size;
    if (props.compact) return "small";
    return "normal";
  };

  return (
    <button
      {...props}
      data-component="button"
      data-size={size()}
      data-variant={props.variant ?? "secondary"}
      data-compact={props.compact ? "true" : undefined}
    >
      {props.children}
    </button>
  );
}
