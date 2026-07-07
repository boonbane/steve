import { batch, onCleanup } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import {
  createApi,
  PAGE_SIZE,
  type Api,
  type Conversation,
  type Message,
  type OutgoingImage,
} from "./api.ts";
import { subscribeEvents } from "./sse.ts";

export type ConnectionStatus = "connecting" | "open" | "closed";

export type Thread = {
  messages: Message[];
  // More history exists upstream of the oldest loaded message.
  hasMore: boolean;
  loading: boolean;
};

export type AppState = {
  conversations: Conversation[];
  threads: Record<string, Thread>;
  activeId: string | null;
  connection: ConnectionStatus;
  status: string; // one-line footer notice (errors, sending, …)
};

// Optimistic bubbles use negative ids so they can never collide with ROWIDs.
let nextTempId = -1;

export function createAppStore(api: Api = createApi()) {
  const [state, setState] = createStore<AppState>({
    conversations: [],
    threads: {},
    activeId: null,
    connection: "connecting",
    status: "",
  });

  async function loadConversations() {
    try {
      const conversations = await api.conversations();
      setState("conversations", reconcile(conversations, { key: "id" }));
    } catch (err) {
      setState("status", `failed to load conversations: ${message(err)}`);
    }
  }

  async function open(id: string) {
    if (state.activeId === id && state.threads[id]) return;
    setState("activeId", id);
    if (!state.threads[id]) {
      setState("threads", id, { messages: [], hasMore: false, loading: true });
      try {
        const page = await api.messages(id);
        setState("threads", id, {
          messages: page,
          hasMore: page.length === PAGE_SIZE,
          loading: false,
        });
      } catch (err) {
        setState("threads", id, "loading", false);
        setState("status", `failed to load messages: ${message(err)}`);
      }
    }
  }

  // Opening is a preview; read receipts only fire on explicit entry.
  function markActiveRead() {
    const id = state.activeId;
    if (!id) return;
    const conversation = state.conversations.find((c) => c.id === id);
    if (!conversation || conversation.unread === 0) return;
    setUnread(id, 0);
    if (!conversation.isGroup) void api.markRead(id);
  }

  async function loadOlder(id: string): Promise<number> {
    const thread = state.threads[id];
    if (!thread || thread.loading || !thread.hasMore) return 0;
    const oldest = thread.messages[0];
    if (!oldest) return 0;
    setState("threads", id, "loading", true);
    try {
      const page = await api.messages(id, oldest.id);
      batch(() => {
        setState("threads", id, "loading", false);
        setState("threads", id, "hasMore", page.length === PAGE_SIZE);
        setState(
          "threads",
          id,
          "messages",
          produce((messages) => {
            const known = new Set(messages.map((m) => m.id));
            messages.unshift(...page.filter((m) => !known.has(m.id)));
          }),
        );
      });
      return page.length;
    } catch (err) {
      batch(() => {
        setState("threads", id, "loading", false);
        setState("status", `failed to load older: ${message(err)}`);
      });
      return 0;
    }
  }

  async function send(id: string, text: string, image?: OutgoingImage) {
    const tempId = nextTempId--;
    const temp: Message = {
      id: tempId,
      conversationId: id,
      sender: "me",
      senderName: null,
      text,
      createdAt: new Date().toISOString(),
      isFromMe: true,
      service: "iMessage",
      // The fake attachment makes the pending bubble show the image chip and
      // marks the temp as adoptable by the SSE echo's attachment row.
      attachments: image
        ? [{ id: tempId, messageId: tempId, mime: image.mime, name: image.name, kind: "image" }]
        : [],
    };
    appendMessage(temp);
    setState("status", "sending…");
    try {
      const sent = await api.send(id, text, image);
      batch(() => {
        setState("status", "");
        // 201: swap the optimistic bubble for the landed row. 202: leave it;
        // the SSE echo replaces it (matched by text) when it arrives.
        if (sent) replaceTemp(id, temp.id, sent);
      });
    } catch (err) {
      batch(() => {
        removeMessage(id, temp.id);
        setState("status", `send failed: ${message(err)}`);
      });
      throw err;
    }
  }

  function appendMessage(msg: Message) {
    const thread = state.threads[msg.conversationId];
    if (!thread) return;
    if (thread.messages.some((m) => m.id === msg.id)) return;
    setState(
      "threads",
      msg.conversationId,
      "messages",
      produce((messages) => {
        messages.push(msg);
      }),
    );
  }

  function removeMessage(id: string, messageId: number) {
    setState(
      "threads",
      id,
      "messages",
      produce((messages) => {
        const idx = messages.findIndex((m) => m.id === messageId);
        if (idx !== -1) messages.splice(idx, 1);
      }),
    );
  }

  function replaceTemp(id: string, tempId: number, real: Message) {
    setState(
      "threads",
      id,
      "messages",
      produce((messages) => {
        const already = messages.findIndex((m) => m.id === real.id);
        const idx = messages.findIndex((m) => m.id === tempId);
        if (idx === -1) return;
        if (already !== -1) messages.splice(idx, 1);
        else messages[idx] = real;
      }),
    );
  }

  function setUnread(id: string, unread: number) {
    const idx = state.conversations.findIndex((c) => c.id === id);
    if (idx !== -1) setState("conversations", idx, "unread", unread);
  }

  function bump(msg: Message) {
    const idx = state.conversations.findIndex((c) => c.id === msg.conversationId);
    if (idx === -1) {
      // New (or unseen) conversation — resync the list from the server.
      void loadConversations();
      return;
    }
    batch(() => {
      setState("conversations", idx, "lastMessageAt", msg.createdAt);
      if (idx > 0) {
        setState(
          "conversations",
          produce((list) => {
            const [row] = list.splice(idx, 1);
            if (row) list.unshift(row);
          }),
        );
      }
    });
  }

  function onMessageReceived(msg: Message) {
    batch(() => {
      // The SSE echo of our own optimistic 202 send: adopt it by text match.
      // An image send's file row carries no matchable text (just the U+FFFC
      // marker), so it adopts the pending image temp by attachment presence;
      // a caption row that follows then appends as its own message, matching
      // how Messages actually stores the pair.
      if (msg.isFromMe) {
        const thread = state.threads[msg.conversationId];
        const temp = thread?.messages.find(
          (m) =>
            m.id < 0 &&
            (m.text === msg.text ||
              (msg.attachments.length > 0 && m.attachments.length > 0)),
        );
        if (temp) {
          replaceTemp(msg.conversationId, temp.id, msg);
          bump(msg);
          return;
        }
      }
      appendMessage(msg);
      bump(msg);
      if (msg.conversationId === state.activeId && !msg.isFromMe) {
        const conversation = state.conversations.find((c) => c.id === msg.conversationId);
        setUnread(msg.conversationId, 0);
        if (conversation && !conversation.isGroup) void api.markRead(msg.conversationId);
      }
    });
  }

  const unsubscribe = subscribeEvents(api.baseUrl, {
    onStatus: (status) => setState("connection", status),
    onEvent: (event) => {
      switch (event.type) {
        case "ready":
          // Re-baseline after connect/reconnect — unread changes don't replay.
          void loadConversations();
          break;
        case "message.received":
          onMessageReceived(event.message);
          break;
        case "conversation.unread":
          if (event.conversationId !== state.activeId) {
            setUnread(event.conversationId, event.unread);
          }
          break;
      }
    },
  });
  onCleanup(unsubscribe);

  void loadConversations();

  return {
    state,
    api,
    open,
    markActiveRead,
    loadOlder,
    send,
    setStatus: (status: string) => setState("status", status),
  };
}

export type Store = ReturnType<typeof createAppStore>;

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
