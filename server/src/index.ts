// Patchwork Lite — server

import { WebSocketServer, WebSocket } from "ws";
import { createPublicKey, createVerify } from "node:crypto";
import {
  PROTOCOL_VERSION,
  HelloMsg,
  BlobMsg,
  ClientMsg,
  ServerMsg,
  canonical,
} from "../../shared/protocol.ts";
import { putProfile, searchProfiles, startDirectorySweep } from "./directory.ts";

const PORT = Number(process.env.PORT ?? 7700);
const BLOB_TTL_MS = 60 * 24 * 60 * 60 * 1000;

interface ConnectedNode {
  ws: WebSocket;
  publicId: string;
  ecdhPublic: string;
}

interface StoredBlob {
  id: string;
  from: string;
  to: string;
  payload: string;
  ts: number;
  expiresAt: number;
}

const nodes = new Map<string, ConnectedNode>();
const blobs = new Map<string, StoredBlob>();
const inbox = new Map<string, string[]>();

const wss = new WebSocketServer({ port: PORT });
console.log(`[server] listening on ws://localhost:${PORT}`);
startDirectorySweep();

wss.on("connection", (ws) => {
  let me: ConnectedNode | null = null;
  console.log("[server] client connected");

  ws.on("message", (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: "err", reason: "bad json" });
      return;
    }

    if (msg.type === "hello") {
      const err = verifyHello(msg);
      if (err) {
        send(ws, { type: "hello_err", reason: err });
        ws.close();
        return;
      }
      me = { ws, publicId: msg.publicId, ecdhPublic: msg.ecdhPublic };
      nodes.set(msg.publicId, me);
      console.log(`[server] hello ok: ${msg.publicId.slice(0, 16)}...`);
      send(ws, { type: "hello_ok", v: PROTOCOL_VERSION, serverTime: Date.now() });
      flushInbox(msg.publicId);
      broadcastPresence(msg.publicId, ws);
      return;
    }

    if (!me) {
      send(ws, { type: "err", reason: "hello required first" });
      return;
    }

    if (msg.type === "blob") {
      storeBlob(msg);
      deliverIfOnline(msg);
      return;
    }

    if (msg.type === "blob_ack") {
      const b = blobs.get(msg.id);
      if (b) {
        blobs.delete(msg.id);
        console.log(`[server] blob acked and deleted: ${msg.id.slice(0, 12)}...`);
      }
      return;
    }

    if (msg.type === "profile_publish") {
      const ok = putProfile(msg.profile);
      console.log(`[server] profile ${ok ? "accepted" : "rejected"}: ${msg.profile.data.name}`);
      return;
    }

    if (msg.type === "profile_search") {
      const results = searchProfiles(msg.query, msg.limit ?? 50);
      send(ws, {
        type: "profile_search_result",
        requestId: msg.requestId,
        profiles: results,
      });
      console.log(`[server] search "${msg.query}" → ${results.length} result(s)`);
      return;
    }
  });

  ws.on("close", () => {
    if (me) {
      nodes.delete(me.publicId);
      console.log(`[server] disconnected: ${me.publicId.slice(0, 16)}...`);
    }
  });
});

function send(ws: WebSocket, msg: ServerMsg) {
  ws.send(JSON.stringify(msg));
}

function verifyHello(msg: HelloMsg): string | null {
  if (msg.v !== PROTOCOL_VERSION) return "protocol version mismatch";
  if (Date.now() - msg.ts > 5 * 60 * 1000) return "hello too old";
  try {
    const pub = createPublicKey({
      key: Buffer.from(msg.publicId, "base64"),
      format: "der",
      type: "spki",
    });
    const v = createVerify("SHA256");
    v.update(
      canonical({
        v: msg.v,
        publicId: msg.publicId,
        ecdhPublic: msg.ecdhPublic,
        ts: msg.ts,
        nonce: msg.nonce,
      }),
    );
    v.end();
    return v.verify(pub, Buffer.from(msg.sig, "base64")) ? null : "bad signature";
  } catch {
    return "bad public key";
  }
}

function storeBlob(msg: BlobMsg) {
  const blob: StoredBlob = {
    id: msg.id,
    from: msg.from,
    to: msg.to,
    payload: msg.payload,
    ts: msg.ts,
    expiresAt: Date.now() + BLOB_TTL_MS,
  };
  blobs.set(blob.id, blob);
  const list = inbox.get(blob.to) ?? [];
  list.push(blob.id);
  inbox.set(blob.to, list);
  console.log(`[server] stored blob ${blob.id.slice(0, 12)}... for ${blob.to.slice(0, 16)}...`);
}

function deliverIfOnline(msg: BlobMsg) {
  const target = nodes.get(msg.to);
  if (!target) return;
  send(target.ws, {
    type: "blob_deliver",
    from: msg.from,
    id: msg.id,
    payload: msg.payload,
    ts: msg.ts,
  });
}

function flushInbox(publicId: string) {
  const list = inbox.get(publicId);
  if (!list?.length) return;
  const target = nodes.get(publicId);
  if (!target) return;
  for (const id of list) {
    const b = blobs.get(id);
    if (!b) continue;
    send(target.ws, {
      type: "blob_deliver",
      from: b.from,
      id: b.id,
      payload: b.payload,
      ts: b.ts,
    });
  }
  inbox.delete(publicId);
  console.log(`[server] flushed ${list.length} queued blob(s) to ${publicId.slice(0, 16)}...`);
}

function broadcastPresence(publicId: string, except: WebSocket) {
  for (const node of nodes.values()) {
    if (node.ws === except) continue;
    send(node.ws, { type: "presence", publicId });
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [id, b] of blobs.entries()) {
    if (now > b.expiresAt) blobs.delete(id);
  }
}, 60 * 1000);
