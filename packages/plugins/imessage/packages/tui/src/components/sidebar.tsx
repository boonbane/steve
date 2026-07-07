import type { ScrollBoxRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { createEffect, createSignal, For, Show } from "solid-js";
import type { Api, Conversation } from "../api.ts";
import { shortTime } from "../format.ts";
import {
  AVATAR_GRID,
  ensureTransmitted,
  idColor,
  imageIdFor,
  placeholderRows,
  pngSize,
  useKittyGraphics,
} from "../kitty.ts";
import { theme } from "../theme.ts";

// Fetched avatar PNGs by conversation id, shared across row remounts (rows are
// recreated on every filter keystroke; refetching per remount would hammer the
// server). null = known to have no avatar.
const avatarPngs = new Map<string, Promise<Uint8Array | null>>();

const AVATAR_PX = 64;

export function Sidebar(props: {
  conversations: Conversation[];
  selectedIndex: number;
  activeId: string | null;
  query: string;
  onQuery: (value: string) => void;
  searchFocused: boolean;
  listFocused: boolean;
  hideUnknown: boolean;
  filterFocused: boolean;
  api: Api;
}) {
  let scroll: ScrollBoxRenderable | undefined;
  const kitty = useKittyGraphics();

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
                api={props.api}
                showAvatar={kitty()}
              />
            )}
          </For>
        </scrollbox>
        <Show when={props.conversations.length === 0}>
          <text fg={theme.textMuted}> no conversations</text>
        </Show>
        <box
          height={1}
          flexShrink={0}
          paddingLeft={1}
          backgroundColor={props.filterFocused ? theme.activeBg : "transparent"}
        >
          <text
            fg={props.filterFocused ? theme.text : theme.textMuted}
            wrapMode="none"
            truncate
          >
            {`[${props.hideUnknown ? "x" : " "}] hide unknown numbers`}
          </text>
        </box>
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
  api: Api;
  showAvatar: boolean;
}) {
  const renderer = useRenderer();
  const [avatar, setAvatar] = createSignal<{ cells: string; color: string } | null>(null);

  createEffect(() => {
    if (!props.showAvatar || avatar() || props.conversation.isGroup) return;
    const conversation = props.conversation;
    let pending = avatarPngs.get(conversation.id);
    if (!pending) {
      pending = props.api.avatarThumb(conversation.id, AVATAR_PX).catch(() => null);
      avatarPngs.set(conversation.id, pending);
    }
    void pending.then((png) => {
      if (!png || !pngSize(png)) return;
      const id = imageIdFor(`avatar:${conversation.id}`);
      ensureTransmitted(renderer, id, png, AVATAR_GRID);
      setAvatar({ cells: placeholderRows(AVATAR_GRID)[0]!, color: idColor(id) });
    });
  });

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

  // A fixed 3-column slot (2 avatar cells + 1 space) whenever the terminal
  // supports kitty graphics, so rows with and without contact photos align.
  const avatarSlot = () =>
    !props.showAvatar ? "" : avatar() ? `${avatar()!.cells} ` : "   ";

  // Flexbox truncation leaves no gap between name and time; lay the row out
  // by hand instead (badge 2 + avatar slot + name + gap + time).
  const parts = () => {
    const time = shortTime(props.conversation.lastMessageAt);
    const slot = props.showAvatar ? 3 : 0;
    const name = truncateTo(
      props.conversation.name,
      ROW_WIDTH - 2 - slot - Bun.stringWidth(time) - 1,
    );
    const gap = Math.max(
      1,
      ROW_WIDTH - 2 - slot - Bun.stringWidth(name) - Bun.stringWidth(time),
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
        <span style={{ fg: avatar()?.color ?? theme.textMuted }}>{avatarSlot()}</span>
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
