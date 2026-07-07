import type { KeyEvent } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { Composer } from "./components/composer.tsx";
import { Messages, type MessagesHandle } from "./components/messages.tsx";
import { Sidebar } from "./components/sidebar.tsx";
import { createApi, type OutgoingImage } from "./api.ts";
import { readClipboardImage } from "./clipboard.ts";
import { filterConversations, isKnown } from "./format.ts";
import { createAppStore, type Store } from "./store.ts";
import { theme } from "./theme.ts";

type Focus = "search" | "sidebar" | "filter" | "messages" | "composer";
const FOCUS_ORDER: Focus[] = ["search", "sidebar", "filter", "messages", "composer"];

export function App(props: {
  store?: Store;
  url?: string;
  clipboard?: () => OutgoingImage | null;
}) {
  const store = props.store ?? createAppStore(createApi(props.url));
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();

  const [focus, setFocus] = createSignal<Focus>("sidebar");
  const [query, setQuery] = createSignal("");
  const [hideUnknown, setHideUnknown] = createSignal(false);
  // Selection tracks the conversation, not the row: live messages reorder the
  // list underneath the cursor and the highlight should follow.
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [attachment, setAttachment] = createSignal<OutgoingImage | null>(null);
  let messagesHandle: MessagesHandle | undefined;

  const filtered = createMemo(() => {
    const base = hideUnknown()
      ? store.state.conversations.filter(isKnown)
      : store.state.conversations;
    return filterConversations(base, query());
  });
  const selectedIndex = createMemo(() => {
    const id = selectedId();
    const index = id ? filtered().findIndex((c) => c.id === id) : -1;
    return index === -1 ? 0 : index;
  });
  const selected = () => filtered()[selectedIndex()] ?? null;
  const moveSelection = (delta: number) => {
    const list = filtered();
    if (list.length === 0) return;
    const next = Math.min(list.length - 1, Math.max(0, selectedIndex() + delta));
    setSelectedId(list[next]!.id);
  };
  const active = () =>
    store.state.conversations.find((c) => c.id === store.state.activeId) ?? null;
  const activeThread = () =>
    store.state.activeId ? (store.state.threads[store.state.activeId] ?? null) : null;

  createEffect(
    on(query, () => setSelectedId(filtered()[0]?.id ?? null), { defer: true }),
  );

  // A pending image belongs to the conversation it was pasted into.
  createEffect(
    on(() => store.state.activeId, () => setAttachment(null), { defer: true }),
  );

  // Browsing previews the thread (debounced so holding j doesn't hammer the
  // API); read receipts only fire on explicit entry (enter / focus change).
  createEffect(
    on(
      () => selected()?.id,
      (id) => {
        if (!id) return;
        const timer = setTimeout(() => void store.open(id), 120);
        onCleanup(() => clearTimeout(timer));
      },
    ),
  );

  // Focusing an input from a key handler must wait a tick, or the editor
  // receives the very keystroke that focused it ("/" lands in the search box,
  // enter submits a stale composer draft).
  const focusLater = (target: Focus) => setTimeout(() => setFocus(target), 0);

  const enterConversation = () => {
    const conversation = selected();
    if (!conversation) return;
    void store.open(conversation.id);
    store.markActiveRead();
    focusLater("composer");
  };

  const cycleFocus = (direction: 1 | -1) => {
    // The message panes only join the cycle once a conversation is open.
    const order: Focus[] = store.state.activeId
      ? FOCUS_ORDER
      : ["search", "sidebar", "filter"];
    const at = order.indexOf(focus());
    const next = order[(Math.max(at, 0) + direction + order.length) % order.length]!;
    setFocus(next);
    if (next === "messages" || next === "composer") store.markActiveRead();
  };

  const quit = () => {
    renderer.destroy();
    process.exit(0);
  };

  useKeyboard((key: KeyEvent) => {
    if (key.name === "tab") {
      cycleFocus(key.shift ? -1 : 1);
      return;
    }
    if (key.name === "escape") {
      // First escape in the composer drops a pending image, second leaves.
      if (focus() === "composer" && attachment()) {
        setAttachment(null);
        return;
      }
      if (focus() === "search") setQuery("");
      setFocus(focus() === "composer" ? "messages" : "sidebar");
      return;
    }

    switch (focus()) {
      case "search":
        if (key.name === "return") setFocus("sidebar");
        break;
      case "sidebar":
        handleSidebarKey(key);
        break;
      case "filter":
        if (
          key.name === "space" ||
          key.sequence === " " ||
          key.name === "return" ||
          key.name === "x"
        ) {
          setHideUnknown((v) => !v);
        } else if (key.name === "q" && !key.ctrl && !key.meta) {
          quit();
        }
        break;
      case "messages":
        handleMessagesKey(key);
        break;
      case "composer":
        if (key.name === "v" && key.ctrl) pasteImage();
        break; // textarea owns everything else
    }
  });

  const handleSidebarKey = (key: KeyEvent) => {
    if (key.name === "j" || key.name === "down") {
      moveSelection(1);
    } else if (key.name === "k" || key.name === "up") {
      moveSelection(-1);
    } else if (key.name === "g" && !key.shift) {
      setSelectedId(filtered()[0]?.id ?? null);
    } else if ((key.name === "g" && key.shift) || key.name === "G") {
      setSelectedId(filtered().at(-1)?.id ?? null);
    } else if (key.name === "return") {
      enterConversation();
    } else if (key.name === "/") {
      focusLater("search");
    } else if (key.name === "x") {
      setHideUnknown((v) => !v);
    } else if (key.name === "q" && !key.ctrl && !key.meta) {
      quit();
    }
  };

  const handleMessagesKey = (key: KeyEvent) => {
    const handle = messagesHandle;
    if (!handle) return;
    if (key.name === "j" || key.name === "down") {
      handle.scrollLine(1);
    } else if (key.name === "k" || key.name === "up") {
      if (handle.atTop()) handle.requestOlder();
      else handle.scrollLine(-1);
    } else if (key.name === "d" && key.ctrl) {
      handle.scrollHalfPage(1);
    } else if (key.name === "u" && key.ctrl) {
      handle.scrollHalfPage(-1);
    } else if (key.name === "g" && !key.shift) {
      handle.scrollToTop();
    } else if ((key.name === "g" && key.shift) || key.name === "G") {
      handle.scrollToBottom();
    } else if (key.name === "return") {
      focusLater("composer");
    } else if (key.name === "q" && !key.ctrl && !key.meta) {
      quit();
    }
  };

  const loadOlder = () => {
    const id = store.state.activeId;
    if (id) void store.loadOlder(id);
  };

  const pasteImage = () => {
    const image = (props.clipboard ?? readClipboardImage)();
    if (image) {
      setAttachment(image);
      store.setStatus("");
    } else {
      store.setStatus("no image on clipboard");
    }
  };

  const send = (text: string) => {
    const id = store.state.activeId;
    if (!id) return;
    const image = attachment() ?? undefined;
    setAttachment(null);
    store.send(id, text, image).catch(() => {
      // surfaced via store.state.status
    });
  };

  const footer = () => {
    const hints =
      focus() === "composer"
        ? "enter send · ctrl-v paste image · ctrl-j newline · esc back · tab focus"
        : focus() === "filter"
          ? "space toggle · tab focus · q quit"
          : "tab focus · j/k move · enter open · / search · x unknown · q quit";
    return ` ${hints}`;
  };
  const footerRight = () => {
    const status = store.state.status;
    if (status) return `${status} `;
    const connection = store.state.connection;
    return connection === "open" ? "● live " : `○ ${connection} `;
  };
  const footerRightColor = () =>
    store.state.status
      ? theme.error
      : store.state.connection === "open"
        ? theme.them
        : theme.textMuted;

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
    >
      <box flexDirection="row" flexGrow={1}>
        <Sidebar
          conversations={filtered()}
          selectedIndex={selectedIndex()}
          activeId={store.state.activeId}
          query={query()}
          onQuery={setQuery}
          searchFocused={focus() === "search"}
          listFocused={focus() === "sidebar"}
          hideUnknown={hideUnknown()}
          filterFocused={focus() === "filter"}
        />
        <box flexDirection="column" flexGrow={1}>
          <Messages
            conversation={active()}
            thread={activeThread()}
            focused={focus() === "messages"}
            onLoadOlder={loadOlder}
            handle={(handle) => (messagesHandle = handle)}
          />
          <Composer
            focused={focus() === "composer"}
            enabled={store.state.activeId != null}
            attachment={attachment()}
            onSend={send}
          />
        </box>
      </box>
      <box flexDirection="row" height={1} flexShrink={0}>
        <text fg={theme.textMuted} wrapMode="none" truncate flexGrow={1}>
          {footer()}
        </text>
        <text fg={footerRightColor()} wrapMode="none" flexShrink={0}>
          {footerRight()}
        </text>
      </box>
    </box>
  );
}
