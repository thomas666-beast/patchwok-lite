const NODE_URL = import.meta.env.VITE_NODE_URL ?? "http://127.0.0.1:7701";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${NODE_URL}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${NODE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export interface WhoAmI {
  nodeId: string;
  name: string;
  publicId: string;
  ecdhPublic: string;
}

export interface Friend {
  public_id: string;
  ecdh_public: string;
  name: string;
  status: "pending_out" | "pending_in" | "accepted";
  created_at: number;
  updated_at: number;
}

export interface Post {
  id: string;
  author: string;
  ts: number;
  text: string;
  likes: number;
  comments: number;
}

export interface PublicProfile {
  publicId: string;
  ecdhPublic: string;
  name: string;
  description: string;
  tags: string[];
  ts: number;
}

export interface AttachmentRef {
  hash: string;
  mime: string;
  name: string;
  size: number;
}

export interface Post {
  id: string;
  author: string;
  ts: number;
  text: string;
  likes: number;
  comments: number;
  attachments: AttachmentRef[];
}

export const nodeApi = {
  whoami: () => get<WhoAmI>("/whoami"),
  friends: () => get<{ friends: Friend[]; pendingIncoming: Friend[] }>("/friends"),
  feed: () => get<{ posts: Post[] }>("/feed"),
  thread: (postId: string) => get<any>(`/thread/${postId}`),
  request: (to: string) => post<{ ok: true }>("/friend/request", { to }),
  accept: (from: string) => post<{ ok: true }>("/friend/accept", { from }),
  decline: (from: string) => post<{ ok: true }>("/friend/decline", { from }),
  unfriend: (from: string) => post<{ ok: true }>("/friend/unfriend", { from }),
  post: (text: string) => post<{ id: string; recipients: number }>("/post", { text }),
  like: (target: string) => post<{ id: string }>("/like", { target }),
  comment: (target: string, text: string) => post<{ id: string }>("/comment", { target, text }),
  profile: () => get<{ name: string; description: string; tags: string[] }>("/profile"),
  saveProfile: (p: { name: string; description: string; tags: string[] }) =>
    post<{ ok: true }>("/profile", p),
  discover: (q: string) =>
    get<{ profiles: Array<{ data: PublicProfile; sig: string }> }>(
      `/discover?q=${encodeURIComponent(q)}`,
    ),
  backup: () => get<{ backup: string }>("/backup"),
  restore: (backup: string) => post<{ ok: true }>("/restore", { backup }),
  status: () => get<{ servers: Array<{ url: string; connected: boolean }> }>("/status"),

  upload: (filename: string, mime: string, dataBase64: string) =>
    post<AttachmentRef>("/upload", { filename, mime, dataBase64 }),
  attachmentUrl: (hash: string) => `${NODE_URL}/attachment/${hash}`,
  postWith: (text: string, attachments: AttachmentRef[]) =>
    post<{ id: string; recipients: number }>("/post", { text, attachments }),
};

export function openEventStream(onEvent: (e: { type: string; data: unknown }) => void) {
  const wsUrl = NODE_URL.replace(/^http/, "ws") + "/events";
  const ws = new WebSocket(wsUrl);
  ws.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data));
    } catch {}
  };
  return ws;
}
