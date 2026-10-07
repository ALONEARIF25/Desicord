"use client";

import { FormEvent, useEffect, useState } from "react";
import { LockKeyhole, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "../../components/Button";

type Server = {
  id: string;
  name: string;
  description: string;
  accent: string;
  accessMode: AccessMode;
  messageCount: number;
  allowedUsernames: string[];
};

type AccessMode = "public" | "read-only" | "private";

type User = {
  id: string;
  username: string;
  roll: string;
  bio: string;
  createdAt: string;
  messageCount: number;
};

type RoomDraft = Pick<Server, "name" | "description" | "accent" | "accessMode"> & {
  allowedUsernames: string;
};

function draftFromServer(server: Server): RoomDraft {
  return {
    name: server.name,
    description: server.description,
    accent: server.accent,
    accessMode: server.accessMode,
    allowedUsernames: server.allowedUsernames.join(", "),
  };
}

export default function ManagePage() {
  const [adminId, setAdminId] = useState("");
  const [servers, setServers] = useState<Server[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [newRoom, setNewRoom] = useState<RoomDraft>({
    name: "",
    description: "",
    accent: "#d5f05f",
    accessMode: "public",
    allowedUsernames: "",
  });
  const [selectedServerId, setSelectedServerId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedId = window.localStorage.getItem("neon-chat-user") ?? "";
    setAdminId(savedId);
    if (!savedId) {
      setLoading(false);
      setError("Sign in as an administrator to manage rooms.");
      return;
    }
    void refresh(savedId);
  }, []);

  async function refresh(userId = adminId) {
    if (!userId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/admin?userId=${encodeURIComponent(userId)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load admin data.");
      setServers(data.servers ?? []);
      setUsers(data.users ?? []);
      setSelectedServerId((current) => current || data.servers?.[0]?.id || "");
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load admin data.");
    } finally {
      setLoading(false);
    }
  }

  async function adminAction(action: string, values: Record<string, unknown> = {}) {
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: adminId, action, ...values }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not complete that action.");
    await refresh();
    setNotice("Saved.");
  }

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await adminAction("createServer", {
        ...newRoom,
        allowedUsernames: newRoom.allowedUsernames.split(",").map((name) => name.trim()).filter(Boolean),
      });
      setNewRoom({ name: "", description: "", accent: "#d5f05f", accessMode: "public", allowedUsernames: "" });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not create the room.");
    }
  }

  async function deleteByDate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedServerId || !dateFrom || !dateTo) return;
    if (!window.confirm("Delete all messages in this date range?")) return;
    setError("");
    try {
      await adminAction("deleteMessagesByDate", {
        serverId: selectedServerId,
        from: new Date(dateFrom).toISOString(),
        to: new Date(dateTo).toISOString(),
      });
      setDateFrom("");
      setDateTo("");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not delete messages.");
    }
  }

  if (loading) return <main className="min-h-screen bg-[var(--color-bg)] p-6 text-[var(--color-text)]">Loading management console...</main>;

  return (
    <main className="min-h-screen bg-[var(--color-bg)] px-5 py-8 text-[var(--color-text)] sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[var(--color-accent)]">
              <ShieldCheck size={18} />
              <span className="text-xs font-bold uppercase tracking-widest">Admin console</span>
            </div>
            <h1 className="mt-2 text-3xl font-semibold">Manage neon rooms</h1>
            <p className="mt-2 text-sm text-[var(--color-muted)]">Rooms, moderation, and account controls.</p>
          </div>
          <Button tone="quiet" onClick={() => void refresh()}>Refresh</Button>
        </header>

        {error && <p className="mb-5 rounded-[6px] border border-[var(--color-accent)]/40 p-3 text-sm text-[var(--color-accent)]">{error}</p>}
        {notice && <p className="mb-5 rounded-[6px] border border-[var(--color-hover)] p-3 text-sm text-[var(--color-muted)]">{notice}</p>}

        <section className="mb-8 rounded-[8px] bg-[var(--color-surface)] p-5">
          <div className="mb-4 flex items-center gap-2"><Plus size={18} /><h2 className="text-lg font-semibold">Create room</h2></div>
          <form onSubmit={createRoom} className="grid gap-3 sm:grid-cols-2">
            <input required placeholder="Room name" value={newRoom.name} onChange={(event) => setNewRoom({ ...newRoom, name: event.target.value })} className="rounded-[4px] bg-[var(--color-bg)] px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-[var(--color-accent)]" />
            <input placeholder="Description" value={newRoom.description} onChange={(event) => setNewRoom({ ...newRoom, description: event.target.value })} className="rounded-[4px] bg-[var(--color-bg)] px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-[var(--color-accent)]" />
            <select value={newRoom.accessMode} onChange={(event) => setNewRoom({ ...newRoom, accessMode: event.target.value as AccessMode })} className="rounded-[4px] bg-[var(--color-bg)] px-3 py-3 text-sm" aria-label="Room access"><option value="public">Public: read and write</option><option value="read-only">Read-only: selected users write</option><option value="private">Private: selected users only</option></select>
            <input type="color" value={newRoom.accent} onChange={(event) => setNewRoom({ ...newRoom, accent: event.target.value })} className="h-11 w-full rounded-[4px] bg-[var(--color-bg)] p-1" aria-label="Room accent" />
            {newRoom.accessMode !== "public" && <input placeholder={newRoom.accessMode === "private" ? "Users with read and write access, separated by commas" : "Users who can send, separated by commas"} value={newRoom.allowedUsernames} onChange={(event) => setNewRoom({ ...newRoom, allowedUsernames: event.target.value })} className="rounded-[4px] bg-[var(--color-bg)] px-3 py-3 text-sm outline-none focus:ring-1 focus:ring-[var(--color-accent)] sm:col-span-2" />}
            <Button type="submit" tone="lime" className="sm:col-span-2">Create room</Button>
          </form>
        </section>

        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-semibold">Rooms</h2><span className="text-sm text-[var(--color-muted)]">{servers.length} total</span></div>
          <div className="space-y-4">
            {servers.map((server) => <RoomEditor key={server.id} server={server} onAction={adminAction} />)}
            {!servers.length && <p className="text-sm text-[var(--color-muted)]">No rooms yet.</p>}
          </div>
        </section>

        <section className="mb-8 rounded-[8px] bg-[var(--color-surface)] p-5">
          <h2 className="text-xl font-semibold">Delete messages by date</h2>
          <form onSubmit={deleteByDate} className="mt-4 grid gap-3 sm:grid-cols-4">
            <select value={selectedServerId} onChange={(event) => setSelectedServerId(event.target.value)} className="rounded-[4px] bg-[var(--color-bg)] px-3 py-3 text-sm sm:col-span-2"><option value="">Choose a room</option>{servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}</select>
            <input required type="datetime-local" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="rounded-[4px] bg-[var(--color-bg)] px-3 py-3 text-sm" aria-label="From date" />
            <input required type="datetime-local" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="rounded-[4px] bg-[var(--color-bg)] px-3 py-3 text-sm" aria-label="To date" />
            <Button type="submit" tone="danger" className="sm:col-span-4">Delete messages in range</Button>
          </form>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-xl font-semibold">Users</h2><span className="text-sm text-[var(--color-muted)]">{users.length} total</span></div>
          <div className="overflow-hidden rounded-[8px] bg-[var(--color-surface)]">
            {users.map((user) => <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-bg)] p-4 last:border-0"><div><p className="font-semibold">{user.username}</p><p className="text-xs text-[var(--color-muted)]">{user.roll} · {user.messageCount} messages</p></div><Button tone="danger" onClick={() => { if (window.confirm(`Delete ${user.username} and all their messages?`)) void adminAction("deleteUser", { targetUserId: user.id }); }}><Trash2 size={15} className="mr-2 inline" />Delete user</Button></div>)}
            {!users.length && <p className="p-4 text-sm text-[var(--color-muted)]">No users yet.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}

function RoomEditor({ server, onAction }: { server: Server; onAction: (action: string, values?: Record<string, unknown>) => Promise<void> }) {
  const [draft, setDraft] = useState<RoomDraft>(() => draftFromServer(server));
  const [error, setError] = useState("");

  async function save() {
    try {
      await onAction("updateServer", { serverId: server.id, ...draft, allowedUsernames: draft.allowedUsernames.split(",").map((name) => name.trim()).filter(Boolean) });
      setError("");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Could not update room.");
    }
  }

  return <article className="rounded-[8px] bg-[var(--color-surface)] p-5">
    <div className="mb-4 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: draft.accent }} /><h3 className="font-semibold">#{server.id}</h3>{draft.accessMode !== "public" && <LockKeyhole size={15} className="text-[var(--color-accent)]" />}</div><span className="text-xs text-[var(--color-muted)]">{server.messageCount} messages</span></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="rounded-[4px] bg-[var(--color-bg)] px-3 py-3 text-sm" aria-label="Room name" />
      <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="rounded-[4px] bg-[var(--color-bg)] px-3 py-3 text-sm" aria-label="Room description" />
      <select value={draft.accessMode} onChange={(event) => setDraft({ ...draft, accessMode: event.target.value as AccessMode })} className="rounded-[4px] bg-[var(--color-bg)] px-3 py-3 text-sm" aria-label="Room access"><option value="public">Public: read and write</option><option value="read-only">Read-only: selected users write</option><option value="private">Private: selected users only</option></select>
      <input type="color" value={draft.accent} onChange={(event) => setDraft({ ...draft, accent: event.target.value })} className="h-11 w-full rounded-[4px] bg-[var(--color-bg)] p-1" aria-label="Room accent" />
      {draft.accessMode !== "public" && <input value={draft.allowedUsernames} onChange={(event) => setDraft({ ...draft, allowedUsernames: event.target.value })} placeholder={draft.accessMode === "private" ? "Users with read and write access, separated by commas" : "Users who can send, separated by commas"} className="rounded-[4px] bg-[var(--color-bg)] px-3 py-3 text-sm sm:col-span-2" aria-label="Allowed usernames" />}
    </div>
    {error && <p className="mt-3 text-sm text-[var(--color-accent)]">{error}</p>}
    <div className="mt-4 flex flex-wrap gap-2"><Button tone="lime" onClick={() => void save()}>Save room</Button><Button tone="quiet" onClick={() => { if (window.confirm("Delete every message in this room?")) void onAction("deleteServerMessages", { serverId: server.id }); }}>Clear messages</Button><Button tone="danger" onClick={() => { if (window.confirm("Delete this room and all its messages?")) void onAction("deleteServer", { serverId: server.id }); }}><Trash2 size={15} className="mr-2 inline" />Delete room</Button></div>
  </article>;
}
