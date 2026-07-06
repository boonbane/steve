import type { ScrollBoxRenderable } from "@opentui/core";
import { createEffect, For, Show } from "solid-js";
import type { Conversation } from "../api.ts";
import { shortTime } from "../format.ts";
import { theme } from "../theme.ts";

export function Sidebar(props: {
  conversations: Conversation[];
  selectedIndex: number;
  activeId: string | null;
  query: string;
  onQuery: (value: string) => void;
  searchFocused: boolean;
  listFocused: boolean;
}) {
  let scroll: ScrollBoxRenderable | undefined;

  createEffect(() => {
    const selected = props.conversations[props.selectedIndex];
    if (selected && scroll) scroll.scrollChildIntoView(`conv-${selected.id}`);
  });

  return (
    <box flexDirection="column" width={34} flexShrink={0}>
      <box
        border
        borderColor={props.searchFocused ? theme.accent : theme.border}
        height={3}
        flexShrink={0}
      >
        <input
          placeholder="search  (/)"
          placeholderColor={theme.placeholder}
          textColor={theme.text}
          focusedTextColor={theme.text}
          backgroundColor="transparent"
          focusedBackgroundColor="transparent"
          cursorColor={theme.accent}
          value={props.query}
          onInput={props.onQuery}
          focused={props.searchFocused}
        />
      </box>
      <box
        border
        borderColor={props.listFocused ? theme.accent : theme.border}
        flexGrow={1}
        flexDirection="column"
      >
        <scrollbox ref={scroll} flexGrow={1} viewportCulling>
          <For each={props.conversations}>
            {(conversation, index) => (
              <ConversationRow
                conversation={conversation}
                selected={index() === props.selectedIndex}
                active={conversation.id === props.activeId}
                focused={props.listFocused}
              />
            )}
          </For>
        </scrollbox>
        <Show when={props.conversations.length === 0}>
          <text fg={theme.textMuted}> no conversations</text>
        </Show>
      </box>
    </box>
  );
}

// Inner row width: sidebar 34 − border 2 − padding 2.
const ROW_WIDTH = 30;

function ConversationRow(props: {
  conversation: Conversation;
  selected: boolean;
  active: boolean;
  focused: boolean;
}) {
  const background = () =>
    props.selected && props.focused
      ? theme.activeBg
      : props.selected || props.active
        ? theme.selectionBg
        : "transparent";
  const nameColor = () =>
    props.conversation.unread > 0
      ? theme.text
      : props.active
        ? theme.accent
        : props.conversation.resolved
          ? theme.text
          : theme.textMuted;

  // Flexbox truncation leaves no gap between name and time; lay the row out
  // by hand instead (badge 2 + name + gap + time).
  const parts = () => {
    const time = shortTime(props.conversation.lastMessageAt);
    const name = truncateTo(
      props.conversation.name,
      ROW_WIDTH - 2 - Bun.stringWidth(time) - 1,
    );
    const gap = Math.max(
      1,
      ROW_WIDTH - 2 - Bun.stringWidth(name) - Bun.stringWidth(time),
    );
    return { name, time, gap: " ".repeat(gap) };
  };

  return (
    <box
      id={`conv-${props.conversation.id}`}
      height={1}
      flexShrink={0}
      backgroundColor={background()}
      paddingLeft={1}
      paddingRight={1}
    >
      <text wrapMode="none">
        <span style={{ fg: theme.badge }}>
          {props.conversation.unread > 0 ? "● " : "  "}
        </span>
        <span style={{ fg: nameColor() }}>{parts().name}</span>
        <span style={{ fg: theme.textMuted }}>
          {parts().gap + parts().time}
        </span>
      </text>
    </box>
  );
}

function truncateTo(value: string, width: number): string {
  if (Bun.stringWidth(value) <= width) return value;
  let out = "";
  for (const ch of value) {
    if (Bun.stringWidth(out + ch) > width - 1) break;
    out += ch;
  }
  return out + "…";
}
