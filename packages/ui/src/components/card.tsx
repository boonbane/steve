import type { JSX } from "solid-js";

type CardProps = {
  tone?: "default" | "success" | "warning" | "error";
} & JSX.HTMLAttributes<HTMLElement>;

export function Card(props: CardProps) {
  return (
    <section
      {...props}
      data-component="card"
      data-tone={props.tone ?? "default"}
    >
      {props.children}
    </section>
  );
}
