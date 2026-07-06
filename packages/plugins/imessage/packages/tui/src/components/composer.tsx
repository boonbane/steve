import type { TextareaRenderable } from "@opentui/core";
import { theme } from "../theme.ts";

export function Composer(props: {
  focused: boolean;
  enabled: boolean;
  onSend: (text: string) => void;
}) {
  let input: TextareaRenderable | undefined;

  const submit = () => {
    if (!input || !props.enabled) return;
    const text = input.plainText.trim();
    if (!text) return;
    props.onSend(text);
    input.clear();
  };

  return (
    <box
      border
      borderColor={props.focused ? theme.accent : theme.border}
      minHeight={3}
      flexShrink={0}
    >
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
