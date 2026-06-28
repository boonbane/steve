import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { Icon } from "@steve/ui/icon";
import { Button } from "@steve/ui/button";

import {
  fetchConversations,
  fetchMessages,
  sendMessage,
  PAGE_SIZE,
  type Attachment,
  type Conversation,
  type Message,
} from "./api";

// A session-unique key for an optimistic message bubble, used only to match it
// to the server's reply on the client. Deliberately not `crypto.randomUUID()`:
// that exists only in a secure context, so it's absent when the app is reached
// over plain HTTP on the tailnet (by IP or MagicDNS name) rather than localhost.
let tempIdSeq = 0;
function nextTempId(): string {
  return `temp-${Date.now()}-${tempIdSeq++}`;
}

function label(conversation: Conversation): string {
  return conversation.name.trim() || conversation.identifier || "Unknown";
}

// Short codes (e.g. "692639" from CVS) are 1:1 chats whose identifier is a bare
// 3–6 digit number — real numbers carry a "+"/country code or formatting.
function isShortcode(conversation: Conversation): boolean {
  return !conversation.isGroup && /^\d{3,6}$/.test(conversation.identifier.trim());
}

// A 1:1 reached by email (an Apple ID) — almost always a real person, so the
// "hide unknown numbers" filter leaves it alone even when it isn't a contact.
function isEmailHandle(conversation: Conversation): boolean {
  return !conversation.isGroup && conversation.identifier.includes("@");
}

// Everything a search query can match against for a conversation.
function searchHaystack(conversation: Conversation): string {
  return [
    conversation.name,
    conversation.identifier,
    ...conversation.participants,
    ...conversation.memberNames,
  ]
    .join(" ")
    .toLowerCase();
}

// Subsequence fuzzy match. Returns a score (higher is better) or -1 if `query`
// is not a subsequence of `text`. Rewards consecutive hits and word-start hits
// so "ns" ranks "Nathan Slaughter" above an incidental "...n...s...".
function fuzzyScore(query: string, text: string): number {
  let qi = 0;
  let score = 0;
  let run = 0;
  let prev = -2;

  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] !== query[qi]) continue;
    run = prev === ti - 1 ? run + 1 : 0;
    const wordStart = ti === 0 || text[ti - 1] === " " || text[ti - 1] === "+";
    score += 1 + run * 2 + (wordStart ? 3 : 0);
    prev = ti;
    qi++;
  }

  return qi === query.length ? score : -1;
}

// Attachment-bearing messages store a U+FFFC object-replacement char as their
// text; strip it so attachment-only messages don't render a stray glyph.
function bodyText(msg: Message): string {
  return msg.text.replace(/￼/g, "").trim();
}

function senderLabel(msg: Message): string {
  return msg.senderName ?? msg.sender;
}

// Float a conversation to the top of the list and refresh its recency when a
// new message arrives — a local patch, so we never refetch the whole list.
function bumpConversation(
  list: Conversation[],
  msg: Message,
): Conversation[] {
  const idx = list.findIndex((c) => c.id === msg.conversationId);
  if (idx === -1) return list;
  const updated = { ...list[idx], lastMessageAt: msg.createdAt };
  return [updated, ...list.slice(0, idx), ...list.slice(idx + 1)];
}

function AttachmentView(props: { att: Attachment }) {
  const url = `/api/attachments/${props.att.id}`;
  return (
    <Switch
      fallback={
        <a data-component="im-file" href={url} target="_blank" rel="noopener">
          📎 {props.att.name}
        </a>
      }
    >
      <Match when={props.att.kind === "image"}>
        <a href={url} target="_blank" rel="noopener">
          <img
            data-component="im-image"
            src={url}
            alt={props.att.name}
            loading="lazy"
          />
        </a>
      </Match>
      <Match when={props.att.kind === "video"}>
        <video data-component="im-video" src={url} controls preload="metadata" />
      </Match>
      <Match when={props.att.kind === "audio"}>
        <audio src={url} controls preload="none" />
      </Match>
    </Switch>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function time(iso: string, withYear = false): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    year: withYear ? "numeric" : undefined,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Subtitle under the conversation name: group → member count, 1:1 → service.
function subtitle(conversation: Conversation): string {
  if (conversation.isGroup) {
    const n = conversation.participants.length;
    return `${conversation.service} · ${n} ${n === 1 ? "person" : "people"}`;
  }
  return conversation.service;
}

function Avatar(props: { conversation: Conversation }) {
  const [failed, setFailed] = createSignal(false);

  createEffect(
    on(
      () => props.conversation.id,
      () => setFailed(false),
      { defer: true },
    ),
  );

  const showPhoto = () =>
    !props.conversation.isGroup && props.conversation.resolved && !failed();

  return (
    <span data-component="im-avatar">
      <Show when={showPhoto()} fallback={initials(label(props.conversation))}>
        <img
          data-component="im-avatar-img"
          src={`/api/conversations/${encodeURIComponent(
            props.conversation.id,
          )}/avatar`}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </Show>
    </span>
  );
}

export default function App() {
  const [
    conversations,
    { refetch: refetchConversations, mutate: mutateConversations },
  ] = createResource(fetchConversations);
  const [active, setActive] = createSignal<Conversation | null>(null);

  // Sidebar search + filtering, applied client-side over the full list.
  const [query, setQuery] = createSignal("");
  const [hideShortcodes, setHideShortcodes] = createSignal(false);
  const [hideUnknown, setHideUnknown] = createSignal(false);

  // Read the resource without throwing on pending/errored states, so a failed
  // load surfaces a message instead of blanking the list.
  const ready = () =>
    conversations.state === "ready" || conversations.state === "refreshing";
  const list = createMemo<Conversation[]>(() =>
    ready() ? (conversations() ?? []) : [],
  );

  const visible = createMemo(() => {
    const base = list().filter(
      (conversation) =>
        (!hideShortcodes() || !isShortcode(conversation)) &&
        (!hideUnknown() ||
          conversation.resolved ||
          isEmailHandle(conversation)),
    );

    const q = query().trim().toLowerCase();
    if (q.length === 0) return base; // server already orders by recency

    return base
      .map((conversation) => ({
        conversation,
        score: fuzzyScore(q, searchHaystack(conversation)),
      }))
      .filter((match) => match.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((match) => match.conversation);
  });

  // The sidebar holds the entire conversation list in memory (so search/filter
  // stay instant), but only the rows in view are mounted. `visible()` can be
  // hundreds of entries; without windowing every one becomes a DOM node and a
  // reconcile target on each keystroke. `count` is a getter so the virtualizer
  // re-measures whenever the filtered list changes; row height is measured from
  // the DOM (`measureElement`) so we don't hard-code the avatar/padding math.
  let listScroller!: HTMLDivElement;
  const rowVirtualizer = createVirtualizer({
    get count() {
      return visible().length;
    },
    getScrollElement: () => listScroller,
    estimateSize: () => 58,
    overscan: 8,
    gap: 4, // mirrors the --space-1 gap the flex list used between rows
  });

  const [messages, setMessages] = createSignal<Message[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [hasMore, setHasMore] = createSignal(false);

  // Composer state. `pending` holds optimistic bubbles for messages we've
  // handed to Messages.app but haven't yet read back from the database.
  const [draft, setDraft] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [pending, setPending] = createSignal<{ tempId: string; text: string }[]>(
    [],
  );
  const [error, setError] = createSignal<string | null>(null);

  let scroller!: HTMLDivElement;

  const toBottom = () =>
    requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });

  // Load the most recent page whenever the active conversation changes.
  createEffect(
    on(active, async (conversation) => {
      setMessages([]);
      setPending([]);
      setError(null);
      setHasMore(false);
      if (!conversation) return;

      setLoading(true);
      const page = await fetchMessages(conversation.id);
      // Ignore if the user switched conversations while we were fetching.
      if (active()?.id !== conversation.id) return;
      setMessages(page);
      setHasMore(page.length === PAGE_SIZE);
      setLoading(false);
      toBottom();
    }),
  );

  // Live updates: subscribe to the server's SSE stream and apply each newly
  // landed message as it arrives, so received texts (and our own sends once the
  // database records them) show up without a manual refresh.
  onMount(() => {
    const source = new EventSource("/api/events");

    source.addEventListener("message.received", (event) => {
      const msg = JSON.parse((event as MessageEvent).data) as Message;

      // Keep the sidebar ordering current by patching just this conversation's
      // recency — no full refetch. A message for a conversation we've never
      // seen (a brand-new thread) is the one case that needs a refetch.
      let known = false;
      mutateConversations((prev) => {
        const list = prev ?? [];
        known = list.some((c) => c.id === msg.conversationId);
        return known ? bumpConversation(list, msg) : list;
      });
      if (!known) refetchConversations();

      if (msg.conversationId !== active()?.id) return;

      // Only auto-scroll if the user is already near the bottom, so we don't
      // yank them away while they're reading older messages.
      const nearBottom =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <
        120;

      setMessages((prev) =>
        prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
      );

      if (nearBottom) toBottom();
    });

    onCleanup(() => source.close());
  });

  // Prepend the next older page, keeping the viewport anchored in place.
  const loadOlder = async () => {
    const conversation = active();
    const oldest = messages()[0];
    if (!conversation || !oldest || loading() || !hasMore()) return;

    setLoading(true);
    const before = scroller.scrollHeight;
    const page = await fetchMessages(conversation.id, oldest.id);
    if (active()?.id !== conversation.id) {
      setLoading(false);
      return;
    }
    setMessages([...page, ...messages()]);
    setHasMore(page.length === PAGE_SIZE);
    setLoading(false);
    requestAnimationFrame(() => {
      scroller.scrollTop += scroller.scrollHeight - before;
    });
  };

  const onScroll = () => {
    if (scroller.scrollTop < 80) loadOlder();
  };

  const send = async (event: Event) => {
    event.preventDefault();
    const conversation = active();
    const text = draft().trim();
    if (!conversation || text.length === 0 || sending()) return;

    // Each optimistic bubble carries a temp id, so we can retire exactly the
    // right one when the server hands back the real message — never matching on
    // text (which collapses duplicate sends).
    const tempId = nextTempId();
    setError(null);
    setDraft("");
    setPending((p) => [...p, { tempId, text }]);
    setSending(true);
    toBottom();

    try {
      const message = await sendMessage(conversation.id, text);
      setPending((p) => p.filter((entry) => entry.tempId !== tempId));
      // The server returns the landed message once it's in the database; add it
      // by id (deduped against any copy the event stream already delivered). A
      // null result means it'll arrive over the stream instead.
      if (message && active()?.id === conversation.id) {
        setMessages((prev) =>
          prev.some((m) => m.id === message.id) ? prev : [...prev, message],
        );
        toBottom();
      }
    } catch (err) {
      setPending((p) => p.filter((entry) => entry.tempId !== tempId));
      setDraft(text);
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <div data-component="im-shell">
      <aside data-component="im-sidebar">
        <header data-component="im-sidebar-head">
          <Icon size={28} />
          <h1>Messages</h1>
        </header>

        <div data-component="im-sidebar-controls">
          <input
            data-component="im-search"
            type="search"
            placeholder="Search"
            autocomplete="off"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <label data-component="im-toggle">
            <input
              type="checkbox"
              checked={hideShortcodes()}
              onChange={(e) => setHideShortcodes(e.currentTarget.checked)}
            />
            Hide short codes
          </label>
          <label data-component="im-toggle">
            <input
              type="checkbox"
              checked={hideUnknown()}
              onChange={(e) => setHideUnknown(e.currentTarget.checked)}
            />
            Hide unknown numbers
          </label>
        </div>

        <div data-component="im-chat-list" ref={listScroller}>
          <Switch>
            <Match when={conversations.loading && list().length === 0}>
              <p data-component="im-hint">Loading chats…</p>
            </Match>
            <Match when={conversations.error}>
              <p data-component="im-hint">
                Couldn’t load conversations. Try reloading the page.
              </p>
            </Match>
            <Match when={visible().length === 0}>
              <p data-component="im-hint">
                {query() ? "No matches." : "No conversations."}
              </p>
            </Match>
            <Match when={true}>
              {/* Spacer sized to the full list so the scrollbar reflects every
                  conversation; only the windowed rows below are mounted, each
                  absolutely positioned at its computed offset. */}
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: `${rowVirtualizer.getTotalSize()}px`,
                }}
              >
                <For each={rowVirtualizer.getVirtualItems()}>
                  {(row) => {
                    const conversation = () => visible()[row.index];
                    return (
                      <Show when={conversation()}>
                        <button
                          data-component="im-chat"
                          data-index={row.index}
                          ref={(el) => rowVirtualizer.measureElement(el)}
                          data-active={
                            active()?.id === conversation()!.id
                              ? "true"
                              : undefined
                          }
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            transform: `translateY(${row.start}px)`,
                          }}
                          onClick={() => setActive(conversation()!)}
                        >
                          <Avatar conversation={conversation()!} />
                          <span data-component="im-chat-meta">
                            <span data-component="im-chat-name">
                              {label(conversation()!)}
                            </span>
                            <span data-component="im-chat-sub">
                              {time(conversation()!.lastMessageAt, true)}
                            </span>
                          </span>
                        </button>
                      </Show>
                    );
                  }}
                </For>
              </div>
            </Match>
          </Switch>
        </div>
      </aside>

      <main data-component="im-thread">
        <Show
          when={active()}
          fallback={
            <div data-component="im-empty">
              <Icon size={56} />
              <p>Select a conversation to read its messages.</p>
            </div>
          }
        >
          <header data-component="im-thread-head">
            <Avatar conversation={active()!} />
            <div>
              <h2>{label(active()!)}</h2>
              <p data-component="im-thread-sub">{subtitle(active()!)}</p>
            </div>
          </header>

          <div data-component="im-messages" ref={scroller} onScroll={onScroll}>
            <Show when={loading() && messages().length > 0}>
              <p data-component="im-hint">Loading older messages…</p>
            </Show>
            <Show when={loading() && messages().length === 0}>
              <p data-component="im-hint">Loading messages…</p>
            </Show>
            <Show when={!loading() && messages().length === 0}>
              <p data-component="im-hint">No messages.</p>
            </Show>
            <For each={messages()}>
              {(msg) => (
                <div
                  data-component="im-bubble-row"
                  data-from-me={msg.isFromMe ? "true" : undefined}
                >
                  <div
                    data-component="im-bubble"
                    data-from-me={msg.isFromMe ? "true" : undefined}
                  >
                    <Show when={!msg.isFromMe && senderLabel(msg)}>
                      <span data-component="im-sender">{senderLabel(msg)}</span>
                    </Show>
                    <Show when={msg.attachments.length > 0}>
                      <div data-component="im-attachments">
                        <For each={msg.attachments}>
                          {(att) => <AttachmentView att={att} />}
                        </For>
                      </div>
                    </Show>
                    <Show when={bodyText(msg)}>
                      <span data-component="im-text">{bodyText(msg)}</span>
                    </Show>
                    <span data-component="im-time">{time(msg.createdAt)}</span>
                  </div>
                </div>
              )}
            </For>
            <For each={pending()}>
              {(entry) => (
                <div data-component="im-bubble-row" data-from-me="true">
                  <div
                    data-component="im-bubble"
                    data-from-me="true"
                    data-pending="true"
                  >
                    <span data-component="im-text">{entry.text}</span>
                    <span data-component="im-time">Sending…</span>
                  </div>
                </div>
              )}
            </For>
          </div>

          <form data-component="im-composer" onSubmit={send}>
            <Show when={error()}>
              <p data-component="im-error">{error()}</p>
            </Show>
            <div data-component="im-composer-row">
              <input
                data-component="im-input"
                type="text"
                placeholder="iMessage"
                autocomplete="off"
                value={draft()}
                disabled={sending()}
                onInput={(e) => setDraft(e.currentTarget.value)}
              />
              <Button
                type="submit"
                variant="primary"
                disabled={sending() || draft().trim().length === 0}
              >
                Send
              </Button>
            </div>
          </form>
        </Show>
      </main>
    </div>
  );
}
