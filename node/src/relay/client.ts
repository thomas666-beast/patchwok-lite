// Patchwork Lite — multi-server relay client

import { WebSocket } from "ws";
import { randomBytes } from "node:crypto";
import {
  PROTOCOL_VERSION,
  ClientMsg,
  ServerMsg,
  SignedProfile,
  canonical,
} from "../../../shared/protocol.ts";
import { sign } from "../crypto/identity.ts";
import type { Identity } from "../crypto/identity.ts";

export interface RelayHandlers {
  onBlob: (from: string, id: string, payload: string, ts: number) => void;
  onPresence: (publicId: string) => void;
  onOpen?: (url: string) => void;
  onClose?: (url: string) => void;
}

interface Connection {
  url: string;
  ws: WebSocket | null;
  closed: boolean;
  reconnectTimer: NodeJS.Timeout | null;
  connected: boolean;
}

interface QueuedBlob {
  to: string;
  payload: string;
  id: string;
  ts: number;
  queuedAt: number;
}

const RECENT_BLOB_TTL_MS = 5 * 60 * 1000;
const RECONNECT_DELAY_MS = 3000;
const SEARCH_TIMEOUT_MS = 3000;
const MAX_QUEUE = 1000;
const QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class RelayClient {
  private conns: Connection[];
  private seenBlobs = new Map<string, number>();
  private lastProfile: SignedProfile | null = null;
  private pendingSearches = new Map<string, (p: SignedProfile[]) => void>();
  private outQueue: QueuedBlob[] = [];

  constructor(
    urls: string[],
    private identity: Identity,
    private handlers: RelayHandlers,
  ) {
    if (urls.length === 0) throw new Error("at least one server URL required");
    this.conns = urls.map((url) => ({
      url,
      ws: null,
      closed: false,
      reconnectTimer: null,
      connected: false,
    }));
    setInterval(() => this.sweepSeen(), 60 * 1000);
  }

  connectAll() {
    for (const c of this.conns) this.connectOne(c);
  }

  close() {
    for (const c of this.conns) {
      c.closed = true;
      if (c.reconnectTimer) clearTimeout(c.reconnectTimer);
      c.ws?.close();
    }
  }

  private connectOne(c: Connection) {
    c.closed = false;
    c.ws = new WebSocket(c.url);

    c.ws.on("open", () => {
      c.connected = true;
      this.sendHello(c);
      this.handlers.onOpen?.(c.url);
      if (this.lastProfile) {
        this.sendOn(c, { type: "profile_publish", profile: this.lastProfile });
      }
      this.flushQueue();
    });

    c.ws.on("message", (raw) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.handle(c, msg);
    });

    c.ws.on("close", () => {
      c.connected = false;
      this.handlers.onClose?.(c.url);
      if (!c.closed) this.scheduleReconnect(c);
    });

    c.ws.on("error", (err) => {
      console.error(`[relay ${c.url}] error: ${err.message}`);
    });
  }

  private scheduleReconnect(c: Connection) {
    if (c.reconnectTimer) return;
    c.reconnectTimer = setTimeout(() => {
      c.reconnectTimer = null;
      console.log(`[relay ${c.url}] reconnecting...`);
      this.connectOne(c);
    }, RECONNECT_DELAY_MS);
  }

  private sendHello(c: Connection) {
    const ts = Date.now();
    const nonce = randomBytes(16).toString("base64");
    const sig = sign(
      this.identity.signPrivate,
      canonical({
        v: PROTOCOL_VERSION,
        publicId: this.identity.publicId,
        ecdhPublic: this.identity.ecdhPublic,
        ts,
        nonce,
      }),
    );
    this.sendOn(c, {
      type: "hello",
      v: PROTOCOL_VERSION,
      publicId: this.identity.publicId,
      ecdhPublic: this.identity.ecdhPublic,
      ts,
      nonce,
      sig,
    });
  }

  private handle(c: Connection, msg: ServerMsg) {
    switch (msg.type) {
      case "hello_ok":
        console.log(`[relay ${c.url}] hello ok`);
        break;
      case "hello_err":
        console.error(`[relay ${c.url}] hello rejected: ${msg.reason}`);
        c.ws?.close();
        break;
      case "blob_deliver": {
        if (this.seenBlobs.has(msg.id)) {
          this.sendOn(c, { type: "blob_ack", id: msg.id });
          return;
        }
        this.seenBlobs.set(msg.id, Date.now());
        this.handlers.onBlob(msg.from, msg.id, msg.payload, msg.ts);
        this.sendOn(c, { type: "blob_ack", id: msg.id });
        break;
      }
      case "presence":
        this.handlers.onPresence(msg.publicId);
        break;
      case "profile_search_result": {
        const key = msg.requestId + ":" + c.url;
        const resolver = this.pendingSearches.get(key);
        if (resolver) {
          this.pendingSearches.delete(key);
          resolver(msg.profiles);
        }
        break;
      }
      case "err":
        console.error(`[relay ${c.url}] server error: ${msg.reason}`);
        break;
    }
  }

  sendBlob(to: string, payload: string): string {
    const id = randomBytes(16).toString("base64");
    const msg: ClientMsg = {
      type: "blob",
      to,
      from: this.identity.publicId,
      id,
      payload,
      ts: Date.now(),
    };
    let sent = 0;
    for (const c of this.conns) if (this.sendOn(c, msg)) sent++;
    if (sent === 0) {
      this.enqueue({ to, payload, id, ts: msg.ts, queuedAt: Date.now() });
      console.warn(`[relay] no connected servers — queued blob ${id.slice(0, 12)}...`);
    }
    return id;
  }

  publishProfile(sp: SignedProfile) {
    this.lastProfile = sp;
    const msg: ClientMsg = { type: "profile_publish", profile: sp };
    let sent = 0;
    for (const c of this.conns) if (this.sendOn(c, msg)) sent++;
    if (sent === 0) {
      console.warn("[relay] no server to publish profile to (will retry on reconnect)");
    }
  }

  searchProfiles(query: string, limit = 50): Promise<SignedProfile[]> {
    const requestId = randomBytes(12).toString("base64");
    const msg: ClientMsg = { type: "profile_search", query, limit, requestId };

    const connected = this.conns.filter((c) => c.connected);
    if (connected.length === 0) {
      console.warn("[relay] no connected servers to search");
      return Promise.resolve([]);
    }

    const perServer = connected.map(
      (c) =>
        new Promise<SignedProfile[]>((resolve) => {
          const key = requestId + ":" + c.url;
          const timer = setTimeout(() => {
            this.pendingSearches.delete(key);
            resolve([]);
          }, SEARCH_TIMEOUT_MS);
          this.pendingSearches.set(key, (profiles) => {
            clearTimeout(timer);
            resolve(profiles);
          });
          this.sendOn(c, msg);
        }),
    );

    return Promise.all(perServer).then((all) => {
      const merged = new Map<string, SignedProfile>();
      for (const list of all) {
        for (const p of list) {
          const existing = merged.get(p.data.publicId);
          if (!existing || existing.data.ts < p.data.ts) {
            merged.set(p.data.publicId, p);
          }
        }
      }
      return Array.from(merged.values()).sort((a, b) => b.data.ts - a.data.ts);
    });
  }

  serverStatus() {
    return this.conns.map((c) => ({ url: c.url, connected: c.connected }));
  }

  private enqueue(item: QueuedBlob) {
    if (this.outQueue.length >= MAX_QUEUE) this.outQueue.shift();
    this.outQueue.push(item);
  }

  private flushQueue() {
    if (this.outQueue.length === 0) return;
    const now = Date.now();
    const toSend = this.outQueue.filter((b) => now - b.queuedAt < QUEUE_TTL_MS);
    this.outQueue = [];
    console.log(`[relay] flushing ${toSend.length} queued blob(s)`);
    for (const b of toSend) {
      const msg: ClientMsg = {
        type: "blob",
        to: b.to,
        from: this.identity.publicId,
        id: b.id,
        payload: b.payload,
        ts: b.ts,
      };
      let sent = 0;
      for (const c of this.conns) if (this.sendOn(c, msg)) sent++;
      if (sent === 0) this.enqueue(b);
    }
  }

  private sendOn(c: Connection, msg: ClientMsg): boolean {
    if (c.ws && c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  private sweepSeen() {
    const cutoff = Date.now() - RECENT_BLOB_TTL_MS;
    for (const [id, ts] of this.seenBlobs.entries()) {
      if (ts < cutoff) this.seenBlobs.delete(id);
    }
  }
}
