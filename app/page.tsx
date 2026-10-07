"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Check,
  CircleX,
  Hash,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Users,
} from "lucide-react";
import { Button } from "./components/Button";

type AccessMode = "public" | "read-only" | "private";
type Server = {
  id: string;
  name: string;
  description: string;
  accent: string;
  accessMode: AccessMode;
  canRead: boolean;
  canWrite: boolean;
};
type User = {
  id: string;
  username: string;
  roll: string;
  bio: string;
  pfp: string;
};
type Message = {
  id: string;
  content: string;
  createdAt: string;
  username: string;
  pfp: string;
  status?: "sending" | "sent" | "failed";
};
type Member = { id: string; username: string; bio: string; pfp: string };

const MESSAGE_PAGE_SIZE = 30;

async function chatRequest(body: object) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Something went wrong.");
  return result;
}

export default function Home() {
  const [servers, setServers] = useState<Server[]>([]);
  const [joined, setJoined] = useState<string[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [activeServer, setActiveServer] = useState<Server | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [message, setMessage] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [showProfile, setShowProfile] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  const [error, setError] = useState("");
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const preservedScrollRef = useRef<{ height: number; top: number } | null>(
    null,
  );

  useEffect(() => {
    const savedId = window.localStorage.getItem("neon-chat-user");
    fetch(`/api/chat${savedId ? `?userId=${savedId}` : ""}`)
      .then((response) => response.json())
      .then((data) => {
        setServers(data.servers ?? []);
        setJoined(data.joined ?? []);
        if (data.user) setUser(data.user);
      })
      .catch(() => setError("Could not connect to the chat."));
  }, []);

  useEffect(() => {
    if (!user || !activeServer) return;
    let cancelled = false;
    setMessages([]);
    setMembers([]);
    setHasMoreMessages(false);
    fetch(`/api/chat?userId=${user.id}&serverId=${activeServer.id}`)
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        setMessages(data.messages ?? []);
        setMembers(data.members ?? []);
        setHasMoreMessages(Boolean(data.hasMore));
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the messages.");
      });
    const events = new EventSource(
      `/api/chat/stream?serverId=${encodeURIComponent(activeServer.id)}&userId=${encodeURIComponent(user.id)}`,
    );
    events.onmessage = (event) => {
      const nextMessage = JSON.parse(event.data) as Message;
      const normalizedMessage =
        nextMessage.username === user.username
          ? { ...nextMessage, pfp: user.pfp }
          : nextMessage;
      setMessages((current) =>
        current.some((item) => item.id === normalizedMessage.id)
          ? current
          : [...current, normalizedMessage],
      );
    };
    events.onerror = () =>
      setError("Realtime connection interrupted. Reconnecting...");
    return () => {
      cancelled = true;
      events.close();
    };
  }, [user, activeServer]);

  useEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList) return;
    const previousScroll = preservedScrollRef.current;
    if (previousScroll) {
      messageList.scrollTop =
        messageList.scrollHeight - previousScroll.height + previousScroll.top;
      preservedScrollRef.current = null;
      return;
    }
    messageList.scrollTo({ top: messageList.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function loadOlderMessages() {
    if (
      !user ||
      !activeServer ||
      !hasMoreMessages ||
      loadingOlderMessages ||
      !messages.length
    )
      return;
    const messageList = messageListRef.current;
    if (messageList) {
      preservedScrollRef.current = {
        height: messageList.scrollHeight,
        top: messageList.scrollTop,
      };
    }
    setLoadingOlderMessages(true);
    const params = new URLSearchParams({
      userId: user.id,
      serverId: activeServer.id,
      before: messages[0].createdAt,
    });
    try {
      const response = await fetch(`/api/chat?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load messages.");
      setMessages((current) => {
        const existingIds = new Set(current.map((item) => item.id));
        const older = (data.messages ?? []).filter(
          (item: Message) => !existingIds.has(item.id),
        );
        return [...older, ...current];
      });
      setHasMoreMessages(Boolean(data.hasMore));
    } catch (loadError) {
      preservedScrollRef.current = null;
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load older messages.",
      );
    } finally {
      setLoadingOlderMessages(false);
    }
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      const result = await chatRequest({
        action: authMode,
        username: String(form.get("username")),
        password: String(form.get("password")),
        roll: String(form.get("roll") ?? ""),
      });
      window.localStorage.setItem("neon-chat-user", result.userId);
      const response = await fetch(`/api/chat?userId=${result.userId}`);
      const data = await response.json();
      setServers(data.servers);
      setJoined(data.joined);
      setUser(data.user);
    } catch (authError) {
      setError(
        authError instanceof Error ? authError.message : "Could not sign in.",
      );
    }
  }

  function logout() {
    window.localStorage.removeItem("neon-chat-user");
    setUser(null);
    setActiveServer(null);
    setMessages([]);
    setJoined([]);
    setShowProfile(false);
    setError("");
  }

  async function joinServer(server: Server) {
    if (!user) return;
    try {
      await chatRequest({ action: "join", userId: user.id, serverId: server.id });
      setJoined((current) =>
        current.includes(server.id) ? current : [...current, server.id],
      );
      setActiveServer(server);
    } catch (joinError) {
      setError(
        joinError instanceof Error
          ? joinError.message
          : "You are not allowed into this room.",
      );
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = message.trim();
    if (!user || !activeServer || !content) return;
    const pendingId = `pending-${crypto.randomUUID()}`;
    setMessages((current) => [
      ...current,
      {
        id: pendingId,
        content,
        createdAt: new Date().toISOString(),
        username: user.username,
        pfp: user.pfp,
        status: "sending",
      },
    ]);
    setMessage("");
    try {
      const result = await chatRequest({
        action: "send",
        userId: user.id,
        serverId: activeServer.id,
        content,
      });
      setMessages((current) => {
        const withoutPending = current.filter((item) => item.id !== pendingId);
        const sentMessage = {
          ...result.message,
          pfp: user.pfp,
          status: "sent" as const,
        };
        if (current.some((item) => item.id === result.message.id))
          return current
            .filter((item) => item.id !== pendingId)
            .map((item) =>
              item.id === result.message.id ? sentMessage : item,
            );
        return [...withoutPending, sentMessage];
      });
      window.setTimeout(() => {
        setMessages((current) =>
          current.map((item) =>
            item.id === result.message.id && item.status === "sent"
              ? { ...item, status: undefined }
              : item,
          ),
        );
      }, 1000);
    } catch (sendError) {
      setMessages((current) =>
        current.map((item) =>
          item.id === pendingId ? { ...item, status: "failed" } : item,
        ),
      );
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Could not send that message.",
      );
    }
  }

  if (!user)
    return (
      <AuthScreen
        mode={authMode}
        setMode={setAuthMode}
        onSubmit={handleAuth}
        error={error}
      />
    );

  return (
    <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] lg:h-screen lg:overflow-hidden">
      <div className="mx-auto flex min-h-screen max-w-[1500px] flex-col lg:h-screen lg:flex-row">
        <aside className="flex w-full shrink-0 flex-col border-b border-[var(--color-bg)] bg-[var(--color-surface)] lg:w-[270px] lg:border-b-0 lg:border-r">
          <div className="p-3">
            <div className="mb-2 flex items-center justify-between px-2">
              <h1 className="text-xs font-bold uppercase tracking-wide text-[var(--color-muted)]">
                Servers
              </h1>
              <span className="text-xs text-[var(--color-muted)]">
                {joined.length}/{servers.length}
              </span>
            </div>
            <div className="space-y-0.5">
              {servers.map((server) => (
                <Button
                  key={server.id}
                  tone="channel"
                  onClick={() =>
                    server.canRead && joined.includes(server.id)
                      ? setActiveServer(server)
                      : joinServer(server)
                  }
                  className={`flex w-full items-center gap-2 px-2 py-1 text-left text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)] ${activeServer?.id === server.id ? "text-[var(--color-text)]" : ""}`}
                >
                  <Hash size={20} strokeWidth={2.5} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">
                    {server.name}
                  </span>
                  {!server.canRead && (
                    <LockKeyhole
                      size={14}
                      strokeWidth={2.5}
                      className="shrink-0"
                    />
                  )}
                </Button>
              ))}
            </div>
          </div>
          <div className="m-3 mt-auto rounded-full border border-[var(--color-hover)] bg-[var(--color-surface)] p-1 shadow-lg">
            <Button
              onClick={() => setShowProfile(true)}
              className="flex w-full items-center gap-3 rounded-full bg-transparent p-2 text-left text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text)]"
            >
              <Avatar value={user.pfp} className="h-9 w-9 text-sm" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {user.username}
                </span>
                <span className="block truncate text-xs text-[var(--color-muted)]">
                  View profile
                </span>
              </span>
            </Button>
          </div>
        </aside>
        <section className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface)]">
          {activeServer ? (
            <>
              <header className="flex items-start justify-between gap-4 border-b border-[var(--color-bg)] bg-[var(--color-surface)] px-5 py-4 sm:px-6">
                <div>
                  <p className="text-base font-semibold"># {activeServer.name}</p>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">
                    {activeServer.description}
                  </p>
                </div>
                <Button
                  type="button"
                  tone="quiet"
                  onClick={() => setShowMembers((current) => !current)}
                  aria-expanded={showMembers}
                  aria-label="Toggle channel members"
                  className="inline-flex shrink-0 items-center gap-2 px-3"
                >
                  <Users size={15} />
                  Members
                </Button>
              </header>
              <div
                ref={messageListRef}
                className="flex-1 overflow-y-auto px-5 py-6 sm:px-6"
              >
                {messages.length ? (
                  <div className="space-y-0">
                    {hasMoreMessages && (
                      <div className="flex justify-center">
                        <Button
                          type="button"
                          tone="quiet"
                          onClick={loadOlderMessages}
                          disabled={loadingOlderMessages}
                          aria-busy={loadingOlderMessages}
                        >
                          {loadingOlderMessages
                            ? "Loading older messages..."
                            : `Load older messages`}
                        </Button>
                      </div>
                    )}
                    {messages.map((item, index) => {
                      const grouped =
                        index > 0 &&
                        messages[index - 1].username === item.username;

                      return (
                        <article
                          key={item.id}
                          className={`flex gap-2 ${!grouped && index > 0 ? "mt-4" : ""}`}
                        >
                          {grouped ? (
                            <span className="w-10 shrink-0" aria-hidden="true" />
                          ) : (
                            <Avatar
                              value={item.pfp}
                              className="h-10 w-10 text-xs"
                            />
                          )}
                          <div className="min-w-0">
                            {!grouped && (
                              <div className="flex items-baseline gap-2">
                                <span className="text-sm font-semibold text-[var(--color-text)]">
                                  {item.username}
                                </span>
                                <time className="text-[10px] text-[var(--color-muted)]">
                                  {new Date(item.createdAt).toLocaleTimeString([], {
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}
                                </time>
                                {item.status === "sending" && (
                                  <LoaderCircle
                                    size={12}
                                    aria-label="Sending"
                                    className="animate-spin text-[var(--color-muted)]"
                                  />
                                )}
                                {item.status === "sent" && (
                                  <Check
                                    size={12}
                                    aria-label="Sent"
                                    className="text-[var(--color-accent)]"
                                  />
                                )}
                                {item.status === "failed" && (
                                  <CircleX
                                    size={12}
                                    aria-label="Failed to send"
                                    className="text-[var(--color-accent)]"
                                  />
                                )}
                              </div>
                            )}
                            <div className="flex items-baseline gap-2">
                              <p className="max-w-2xl text-sm leading-5 text-[var(--color-text)]">
                                {item.content}
                              </p>
                              {grouped && item.status === "sending" && (
                                <LoaderCircle
                                  size={12}
                                  aria-label="Sending"
                                  className="shrink-0 animate-spin text-[var(--color-muted)]"
                                />
                              )}
                              {grouped && item.status === "sent" && (
                                <Check
                                  size={12}
                                  aria-label="Sent"
                                  className="shrink-0 text-[var(--color-accent)]"
                                />
                              )}
                              {grouped && item.status === "failed" && (
                                <CircleX
                                  size={12}
                                  aria-label="Failed to send"
                                  className="shrink-0 text-[var(--color-accent)]"
                                />
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-center">
                    <div>
                      <p className="text-lg font-semibold">
                        This room is quiet.
                      </p>
                      <p className="mt-1 text-sm text-[var(--color-muted)]">
                        Start the conversation.
                      </p>
                    </div>
                  </div>
                )}
              </div>
              {activeServer.canWrite ? (
                <form
                  onSubmit={sendMessage}
                  className="border-t border-[var(--color-bg)] p-3"
                >
                  <input
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder={`Message #${activeServer.name.toLowerCase().replaceAll(" ", "-")}`}
                    className="w-full rounded-full border border-[var(--color-bg)] bg-[var(--color-bg)] px-4 py-3 text-sm text-[var(--color-text)] outline-none ring-0 placeholder:text-[var(--color-muted)] focus:border-[var(--color-bg)] focus:ring-0"
                  />
                </form>
              ) : (
                <div className="border-t border-[var(--color-bg)] px-5 py-4 text-sm text-[var(--color-muted)]">
                  You can read this room, but only selected members can send messages.
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center bg-[var(--color-surface)] p-6 text-center">
              <div>
                <p className="text-2xl font-semibold">Pick a room to begin.</p>
                <p className="mt-2 text-sm text-[var(--color-muted)]">
                  Join any server from the left.
                </p>
              </div>
            </div>
          )}
        </section>
        {activeServer && showMembers && (
          <aside className="w-full shrink-0 border-t border-[var(--color-bg)] bg-[var(--color-surface)] px-4 py-4 lg:w-[240px] lg:border-l lg:border-t-0">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wide text-[var(--color-muted)]">
                Members with access
              </h2>
              <span className="text-xs text-[var(--color-muted)]">{members.length}</span>
            </div>
            <div className="space-y-1">
              {members.map((member) => (
                <div key={member.id} className="flex min-w-0 items-center gap-3 rounded-[6px] px-2 py-2">
                  <Avatar value={member.pfp} className="h-8 w-8 text-xs" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{member.username}</p>
                    {member.bio && <p className="truncate text-xs text-[var(--color-muted)]">{member.bio}</p>}
                  </div>
                </div>
              ))}
              {!members.length && <p className="text-sm text-[var(--color-muted)]">No members with access.</p>}
            </div>
          </aside>
        )}
      </div>
      {showProfile && (
        <Profile
          user={user}
          onClose={() => setShowProfile(false)}
          onLogout={logout}
          onSaved={(nextUser) => {
            setUser(nextUser);
            setShowProfile(false);
          }}
        />
      )}
    </main>
  );
}

function AuthScreen({
  mode,
  setMode,
  onSubmit,
  error,
}: {
  mode: "login" | "register";
  setMode: (mode: "login" | "register") => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  error: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] px-5 py-10 text-[var(--color-text)]">
      <div className="w-full max-w-md rounded-[8px] bg-[var(--color-surface)] p-6 sm:p-9">
        <h1 className="text-3xl font-semibold tracking-tight">
          {mode === "register" ? "Make a room for yourself." : "Welcome back."}
        </h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          {mode === "register"
            ? "A small place for campus conversations."
            : "Sign in to keep chatting."}
        </p>
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <label className="block text-sm font-semibold">
            Username
            <input
              name="username"
              required
              className="mt-2 w-full rounded-[4px] border border-[var(--color-bg)] bg-[var(--color-bg)] px-3 py-3 font-normal text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            />
          </label>
          {mode === "register" && (
            <label className="block text-sm font-semibold">
              Your College Roll
              <input
                name="roll"
                required
                className="mt-2 w-full rounded-[4px] border border-[var(--color-bg)] bg-[var(--color-bg)] px-3 py-3 font-normal text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
              />
            </label>
          )}
          <label className="block text-sm font-semibold">
            Password
            <input
              name="password"
              type="password"
              minLength={6}
              required
              className="mt-2 w-full rounded-[4px] border border-[var(--color-bg)] bg-[var(--color-bg)] px-3 py-3 font-normal text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
            />
          </label>
          <Button type="submit" tone="dark" className="w-full">
            {mode === "register" ? "Create account" : "Sign in"}
          </Button>
          {error && (
            <p className="text-sm text-[var(--color-accent)]">{error}</p>
          )}
        </form>
        <Button
          tone="quiet"
          onClick={() => setMode(mode === "register" ? "login" : "register")}
          className="mt-6 border-0 px-0 text-sm text-[var(--color-accent)] hover:bg-transparent hover:text-[var(--color-text)]"
        >
          {mode === "register"
            ? "Already have an account? Sign in"
            : "New here? Create an account"}
        </Button>
      </div>
    </main>
  );
}

function Avatar({ value, className }: { value: string; className: string }) {
  return value.startsWith("http") ? (
    <img
      src={value}
      alt=""
      className={`${className} shrink-0 rounded-full object-cover`}
    />
  ) : (
    <span
      className={`${className} flex shrink-0 items-center justify-center rounded-full bg-[var(--color-hover)] font-bold`}
    >
      {value}
    </span>
  );
}

function Profile({
  user,
  onClose,
  onLogout,
  onSaved,
}: {
  user: User;
  onClose: () => void;
  onLogout: () => void;
  onSaved: (user: User) => void;
}) {
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set("userId", user.id);
    setError("");
    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not save your profile.");
      onSaved(result.user);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save your profile.",
      );
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-[var(--color-bg)]/75 px-5">
      <form
        onSubmit={save}
        className="w-full max-w-md rounded-[8px] bg-[var(--color-surface)] p-6"
      >
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Your profile</h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              {user.roll}
            </p>
          </div>
          <Button
            tone="quiet"
            type="button"
            onClick={onClose}
            className="border-0 px-2 text-2xl leading-none"
            aria-label="Close profile"
          >
            ×
          </Button>
        </div>
        <div className="flex items-center gap-4">
          <Avatar value={user.pfp} className="h-16 w-16 text-lg" />
          <label className="block text-sm font-semibold">
            Profile picture
            <input
              name="avatar"
              type="file"
              accept="image/*"
              className="mt-2 block w-full text-sm font-normal file:mr-3 file:rounded-[4px] file:border-0 file:bg-[var(--color-bg)] file:px-3 file:py-2 file:text-[var(--color-text)] file:font-semibold"
            />
          </label>
        </div>
        <label className="mt-5 block text-sm font-semibold">
          Bio
          <textarea
            name="bio"
            defaultValue={user.bio}
            maxLength={160}
            rows={4}
            className="mt-2 w-full resize-none rounded-[4px] border border-[var(--color-bg)] bg-[var(--color-bg)] p-3 font-normal text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
          />
        </label>
        {error && (
          <p className="mt-4 text-sm text-[var(--color-accent)]">{error}</p>
        )}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            tone="danger"
            onClick={onLogout}
            className="inline-flex items-center"
          >
            <LogOut size={15} className="mr-2" />
            Log out
          </Button>
          <div className="flex gap-3">
          <Button type="button" tone="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" tone="lime">
            Save profile
          </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
