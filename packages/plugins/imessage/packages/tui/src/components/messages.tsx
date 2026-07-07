import type { ScrollBoxRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { createEffect, createSignal, For, on, Show } from "solid-js";
import type { Api, Attachment, Conversation, Message } from "../api.ts";
import { attachmentLabel, bodyText, messageStamp, senderLabel } from "../format.ts";
import {
  ensureTransmitted,
  fitGrid,
  idColor,
  placeholderRows,
  pngSize,
  useKittyGraphics,
} from "../kitty.ts";
import { theme } from "../theme.ts";
import type { Thread } from "../store.ts";

// Thumbnail budget in source pixels; ~42 cols of cells even on hidpi.
const THUMB_PX = 720;

export type MessagesHandle = {
  scrollLine: (delta: number) => void;
  scrollHalfPage: (direction: 1 | -1) => void;
  scrollToTop: () => void;
  scrollToBottom: () => void;
  atTop: () => boolean;
  requestOlder: () => void;
};

export function Messages(props: {
  conversation: Conversation | null;
  thread: Thread | null;
  focused: boolean;
  api: Api;
  onLoadOlder: () => void;
  handle: (handle: MessagesHandle) => void;
}) {
  let scroll: ScrollBoxRenderable | undefined;
  const kitty = useKittyGraphics();

  // Anchor captured when a top-load starts; consumed once the prepended rows
  // have been laid out, so the viewport stays on the message it was showing.
  let anchor: { height: number; top: number } | null = null;
  const requestOlder = () => {
    if (!scroll) return;
    anchor = { height: scroll.scrollHeight, top: scroll.scrollTop };
    props.onLoadOlder();
  };

  props.handle({
    scrollLine: (delta) => scroll?.scrollBy(delta),
    scrollHalfPage: (direction) => {
      if (!scroll) return;
      if (direction < 0 && scroll.scrollTop === 0) {
        requestOlder();
        return;
      }
      scroll.scrollBy(direction * Math.max(1, Math.floor(scroll.viewport.height / 2)));
    },
    scrollToTop: () => {
      scroll?.scrollTo(0);
      requestOlder();
    },
    scrollToBottom: () => scroll?.scrollTo(scroll.scrollHeight),
    atTop: () => (scroll ? scroll.scrollTop === 0 : true),
    requestOlder,
  });

  createEffect(
    on(
      () => props.thread?.messages[0]?.id,
      (first, prevFirst) => {
        if (first == null || prevFirst == null || first === prevFirst) return;
        // A beat later so yoga has laid out the prepended children.
        setTimeout(() => {
          if (!scroll || !anchor) return;
          scroll.scrollTo(anchor.top + scroll.scrollHeight - anchor.height);
          anchor = null;
        }, 64);
      },
    ),
  );

  const title = () => {
    const conversation = props.conversation;
    if (!conversation) return "iMessage";
    const members =
      conversation.isGroup && conversation.memberNames.length
        ? ` — ${conversation.memberNames.join(", ")}`
        : conversation.identifier !== conversation.name
          ? ` — ${conversation.identifier}`
          : "";
    return ` ${conversation.name}${members} `;
  };

  return (
    <box
      border
      borderColor={props.focused ? theme.accent : theme.border}
      title={title()}
      titleColor={props.focused ? theme.accent : theme.textMuted}
      flexGrow={1}
      flexDirection="column"
    >
      <Show
        when={props.conversation}
        fallback={<text fg={theme.textMuted}> select a conversation (j/k, enter)</text>}
      >
        <Show when={props.thread?.loading}>
          <text fg={theme.textMuted}> loading…</text>
        </Show>
        <scrollbox
          ref={scroll}
          flexGrow={1}
          stickyScroll
          stickyStart="bottom"
          viewportCulling
          paddingLeft={1}
          paddingRight={1}
        >
          <Show when={props.thread?.hasMore}>
            <text fg={theme.textMuted} marginBottom={1}>
              ── older history above (g / ctrl-u to load) ──
            </text>
          </Show>
          <For each={props.thread?.messages ?? []}>
            {(message) => (
              <MessageRow
                message={message}
                isGroup={props.conversation?.isGroup ?? false}
                api={props.api}
                kitty={kitty()}
              />
            )}
          </For>
        </scrollbox>
      </Show>
    </box>
  );
}

function MessageRow(props: {
  message: Message;
  isGroup: boolean;
  api: Api;
  kitty: boolean;
}) {
  const pending = () => props.message.id < 0;
  const body = () => bodyText(props.message);
  const header = () => {
    const who = props.message.isFromMe ? "me" : senderLabel(props.message);
    const stamp = pending() ? "sending…" : messageStamp(props.message.createdAt);
    return `${who} · ${stamp}`;
  };

  return (
    <box
      id={`msg-${props.message.id}`}
      flexDirection="column"
      alignSelf={props.message.isFromMe ? "flex-end" : "flex-start"}
      alignItems={props.message.isFromMe ? "flex-end" : "flex-start"}
      maxWidth="85%"
      marginBottom={1}
      flexShrink={0}
    >
      <text
        fg={props.message.isFromMe ? theme.me : theme.them}
        wrapMode="none"
        truncate
      >
        {header()}
      </text>
      <Show when={body()}>
        <text fg={pending() ? theme.textMuted : theme.text} wrapMode="word">
          {body()}
        </text>
      </Show>
      <For each={props.message.attachments}>
        {(attachment) =>
          attachment.kind === "image" && attachment.id > 0 ? (
            <InlineImage attachment={attachment} api={props.api} enabled={props.kitty} />
          ) : (
            <text fg={theme.textMuted} wrapMode="none" truncate>
              {attachmentLabel(attachment)}
            </text>
          )
        }
      </For>
    </box>
  );
}

// Renders an image attachment as kitty Unicode-placeholder cells when the
// terminal supports the graphics protocol; anything else (unsupported
// terminal, fetch/convert failure, capabilities still being queried) falls
// back to the text label.
function InlineImage(props: { attachment: Attachment; api: Api; enabled: boolean }) {
  const renderer = useRenderer();
  const [placement, setPlacement] = createSignal<{ rows: string[]; color: string } | null>(null);

  createEffect(() => {
    if (placement() || !props.enabled) return;
    const id = props.attachment.id;
    void props.api
      .attachmentThumb(id, THUMB_PX)
      .then((png) => {
        const size = pngSize(png);
        if (!size) return;
        const grid = fitGrid(size);
        ensureTransmitted(renderer, id, png, grid);
        setPlacement({ rows: placeholderRows(grid), color: idColor(id) });
      })
      .catch(() => {
        // Label fallback already showing.
      });
  });

  return (
    <Show
      when={placement()}
      fallback={
        <text fg={theme.textMuted} wrapMode="none" truncate>
          {attachmentLabel(props.attachment)}
        </text>
      }
    >
      {(p) => (
        <box flexDirection="column" flexShrink={0}>
          <For each={p().rows}>
            {(row) => (
              <text fg={p().color} wrapMode="none">
                {row}
              </text>
            )}
          </For>
        </box>
      )}
    </Show>
  );
}
