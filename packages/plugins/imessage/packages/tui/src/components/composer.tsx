import type { TextareaRenderable } from "@opentui/core";
import { Show } from "solid-js";
import type { OutgoingImage } from "../api.ts";
import { theme } from "../theme.ts";

export function Composer(props: {
  focused: boolean;
  enabled: boolean;
  attachment: OutgoingImage | null;
  onSend: (text: string) => void;
}) {
  let input: TextareaRenderable | undefined;

  const submit = () => {
    if (!input || !props.enabled) return;
    const text = input.plainText.trim();
    if (!text && !props.attachment) return;
    props.onSend(text);
    input.clear();
  };

  return (
    <box
      border
      borderColor={props.focused ? theme.accent : theme.border}
      minHeight={3}
      flexShrink={0}
      flexDirection="column"
    >
      <Show when={props.attachment}>
        {(attachment) => (
          <text fg={theme.accent} wrapMode="none" truncate>
            {` 🖼 ${attachment().name} · ${sizeLabel(attachment().data.length)} — esc removes`}
          </text>
        )}
      </Show>
      <textarea
        ref={input}
        placeholder={props.enabled ? "iMessage  (enter to send, ctrl-j for newline)" : "no conversation selected"}
        placeholderColor={theme.placeholder}
        textColor={theme.text}
        focusedTextColor={theme.text}
        backgroundColor="transparent"
        focusedBackgroundColor="transparent"
        cursorColor={theme.accent}
        minHeight={1}
        maxHeight={6}
        wrapMode="word"
        focused={props.focused}
        onSubmit={submit}
        keyBindings={[
          { name: "return", action: "submit" },
          { name: "j", ctrl: true, action: "newline" },
          { name: "return", shift: true, action: "newline" },
        ]}
      />
    </box>
  );
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
