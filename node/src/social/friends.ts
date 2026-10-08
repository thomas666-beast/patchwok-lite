// Patchwork Lite — friend graph + handshake

import Database from "better-sqlite3";
import {
  createPublicKey,
  diffieHellman,
  hkdfSync,
  randomBytes,
  KeyObject,
} from "node:crypto";
import {
  InnerEnvelope,
  FriendRequestData,
  FriendAcceptData,
  FriendDeclineData,
  canonical,
} from "../../../shared/protocol.ts";
import { sign, verify, verifyObject } from "../crypto/identity.ts";
import { seal, unseal, SealedEnvelope } from "../crypto/envelope.ts";
import { getPeerSyncState, setPeerSyncState } from "../crypto/keystore.ts";
import type { Identity } from "../crypto/identity.ts";
import type { RelayClient } from "../relay/client.ts";

export interface FriendRow {
  public_id: string;
  ecdh_public: string;
  name: string;
  shared_key: string;
  status: "pending_out" | "pending_in" | "accepted";
  created_at: number;
  updated_at: number;
}

export function deriveSharedKey(
  myEcdhPrivate: KeyObject,
  theirEcdhPublicB64: string,
): Buffer {
  const theirPub = createPublicKey({
    key: Buffer.from(theirEcdhPublicB64, "base64"),
    format: "der",
    type: "spki",
  });
  const secret = diffieHellman({ privateKey: myEcdhPrivate, publicKey: theirPub });
  const derived = hkdfSync(
    "sha256",
    secret,
    Buffer.alloc(0),
    Buffer.from("friend-content"),
    32,
  );
  return Buffer.from(derived);
}

export function getFriend(db: Database.Database, publicId: string): FriendRow | undefined {
  return db.prepare("SELECT * FROM friends WHERE public_id = ?").get(publicId) as
    | FriendRow
    | undefined;
}

export function listFriends(db: Database.Database): FriendRow[] {
  return db
    .prepare("SELECT * FROM friends WHERE status = 'accepted' ORDER BY name")
    .all() as FriendRow[];
}

export function listPendingIncoming(db: Database.Database): FriendRow[] {
  return db
    .prepare("SELECT * FROM friends WHERE status = 'pending_in' ORDER BY created_at")
    .all() as FriendRow[];
}

export function getSharedKey(db: Database.Database, publicId: string): Buffer | null {
  const row = db
    .prepare("SELECT shared_key FROM friends WHERE public_id = ? AND status = 'accepted'")
    .get(publicId) as { shared_key: string } | undefined;
  if (!row || !row.shared_key) return null;
  return Buffer.from(row.shared_key, "base64");
}

function upsertFriend(
  db: Database.Database,
  row: Omit<FriendRow, "created_at" | "updated_at">,
) {
  const now = Date.now();
  const existing = getFriend(db, row.public_id);
  if (existing) {
    db.prepare(
      `UPDATE friends SET ecdh_public=?, name=?, shared_key=?, status=?, updated_at=? WHERE public_id=?`,
    ).run(row.ecdh_public, row.name, row.shared_key, row.status, now, row.public_id);
  } else {
    db.prepare(
      `INSERT INTO friends (public_id, ecdh_public, name, shared_key, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.public_id, row.ecdh_public, row.name, row.shared_key, row.status, now, now);
  }
}

function sealFor(inner: InnerEnvelope, key: Buffer): string {
  return Buffer.from(JSON.stringify(seal(inner, key)), "utf8").toString("base64");
}

function noteSeenFrom(db: Database.Database, fromPublicId: string, ts: number) {
  const current = getPeerSyncState(db, fromPublicId);
  if (ts > current.last_seen_ts) {
    setPeerSyncState(db, fromPublicId, { last_seen_ts: ts });
  }
}

// ---------- outgoing ----------

export async function sendFriendRequest(
  db: Database.Database,
  identity: Identity,
  relay: RelayClient,
  toPublicId: string,
  myName: string,
) {
  const existing = getFriend(db, toPublicId);

  if (existing && existing.status === "accepted") {
    console.log(`[friends] already friends with ${toPublicId.slice(0, 12)}...`);
    return { nonce: null, alreadyFriends: true };
  }

  if (existing && existing.status === "pending_in") {
    console.log(
      `[friends] incoming request exists from ${toPublicId.slice(0, 12)}... — auto-accepting`,
    );
    acceptFriendRequest(db, identity, relay, toPublicId, myName);
    return { nonce: null, autoAccepted: true };
  }

  const nonce = randomBytes(16).toString("base64");
  const ts = Date.now();
  const data: FriendRequestData = {
    from: identity.publicId,
    fromEcdh: identity.ecdhPublic,
    name: myName,
    nonce,
    ts,
  };
  const sig = sign(identity.signPrivate, canonical(data));
  const inner: InnerEnvelope = { kind: "friend_request", data: data as any, sig };
  const payload = Buffer.from(JSON.stringify(inner), "utf8").toString("base64");
  relay.sendBlob(toPublicId, payload);

  upsertFriend(db, {
    public_id: toPublicId,
    ecdh_public: "",
    name: toPublicId.slice(0, 12),
    shared_key: "",
    status: "pending_out",
  });
  db.prepare(
    `INSERT OR REPLACE INTO pending_nonces (nonce, peer_public_id, direction, created_at)
     VALUES (?, ?, 'out', ?)`,
  ).run(nonce, toPublicId, ts);
  return { nonce };
}

export function acceptFriendRequest(
  db: Database.Database,
  identity: Identity,
  relay: RelayClient,
  toPublicId: string,
  myName: string,
) {
  const pending = db
    .prepare("SELECT * FROM pending_nonces WHERE peer_public_id = ? AND direction = 'in'")
    .get(toPublicId) as { nonce: string } | undefined;
  if (!pending) throw new Error("no pending incoming request from that peer");

  const friend = getFriend(db, toPublicId);
  if (!friend) throw new Error("no friend row");

  const data: FriendAcceptData = {
    from: identity.publicId,
    fromEcdh: identity.ecdhPublic,
    name: myName,
    nonce: pending.nonce,
    ts: Date.now(),
  };
  const sig = sign(identity.signPrivate, canonical(data));
  const inner: InnerEnvelope = { kind: "friend_accept", data: data as any, sig };
  const payload = Buffer.from(JSON.stringify(inner), "utf8").toString("base64");
  relay.sendBlob(toPublicId, payload);

  const sharedKey = deriveSharedKey(identity.ecdhPrivate, friend.ecdh_public);
  upsertFriend(db, {
    public_id: toPublicId,
    ecdh_public: friend.ecdh_public,
    name: friend.name,
    shared_key: sharedKey.toString("base64"),
    status: "accepted",
  });
  db.prepare("DELETE FROM pending_nonces WHERE nonce = ?").run(pending.nonce);
  console.log(`[friends] accepted ${friend.name} (${toPublicId.slice(0, 12)}...)`);
}

export function declineFriendRequest(
  db: Database.Database,
  identity: Identity,
  relay: RelayClient,
  toPublicId: string,
) {
  const pending = db
    .prepare("SELECT * FROM pending_nonces WHERE peer_public_id = ? AND direction = 'in'")
    .get(toPublicId) as { nonce: string } | undefined;
  if (!pending) return;

  const data: FriendDeclineData = {
    from: identity.publicId,
    nonce: pending.nonce,
    ts: Date.now(),
  };
  const sig = sign(identity.signPrivate, canonical(data));
  const inner: InnerEnvelope = { kind: "friend_decline", data: data as any, sig };
  const payload = Buffer.from(JSON.stringify(inner), "utf8").toString("base64");
  relay.sendBlob(toPublicId, payload);

  db.prepare("DELETE FROM friends WHERE public_id = ?").run(toPublicId);
  db.prepare("DELETE FROM pending_nonces WHERE nonce = ?").run(pending.nonce);
}

export function unfriend(
  db: Database.Database,
  identity: Identity,
  relay: RelayClient,
  toPublicId: string,
) {
  const sharedKey = getSharedKey(db, toPublicId);
  if (!sharedKey) throw new Error("not friends");

  const data = { from: identity.publicId, ts: Date.now() };
  const sig = sign(identity.signPrivate, canonical(data));
  const inner: InnerEnvelope = { kind: "unfriend", data, sig };
  relay.sendBlob(toPublicId, sealFor(inner, sharedKey));

  db.prepare("DELETE FROM friends WHERE public_id = ?").run(toPublicId);
  console.log(`[friends] unfriended ${toPublicId.slice(0, 12)}...`);
}

// ---------- incoming ----------

export interface HandshakeHandlers {
  onFriendAccepted?: (publicId: string, name: string) => void;
  onFriendRequest?: (publicId: string, name: string) => void;
}

export async function handleInner(
  db: Database.Database,
  identity: Identity,
  relay: RelayClient,
  fromPublicId: string,
  rawPayloadBase64: string,
  myName: string,
  attachmentsDir: string,
  handlers: HandshakeHandlers = {},
) {
  let inner: InnerEnvelope;
  const sharedKey = getSharedKey(db, fromPublicId);

  if (sharedKey) {
    try {
      const sealed = JSON.parse(
        Buffer.from(rawPayloadBase64, "base64").toString("utf8"),
      ) as SealedEnvelope;
      inner = unseal(sealed, sharedKey);
    } catch (err) {
      console.warn(
        `[friends] sealed payload from friend ${fromPublicId.slice(0, 12)}... failed: ${(err as Error).message}`,
      );
      return;
    }
  } else {
    try {
      inner = JSON.parse(
        Buffer.from(rawPayloadBase64, "base64").toString("utf8"),
      ) as InnerEnvelope;
    } catch {
      console.warn(
        `[friends] bad plaintext payload from non-friend ${fromPublicId.slice(0, 12)}...`,
      );
      return;
    }
  }

  switch (inner.kind) {
    case "friend_request":
      return handleIncomingRequest(db, identity, relay, fromPublicId, inner, myName, handlers);
    case "friend_accept":
      return handleIncomingAccept(db, identity, fromPublicId, inner, handlers);
    case "friend_decline":
      return handleIncomingDecline(db, fromPublicId, inner);
    case "unfriend":
      return handleUnfriend(db, fromPublicId);
    case "post": {
      const { receivePost } = await import("./content.ts");
      const stored = receivePost(db, inner);
      const ts = (inner.data as { ts?: number }).ts;
      if (ts) noteSeenFrom(db, fromPublicId, ts);
      console.log(
        `[friends] post from ${fromPublicId.slice(0, 12)}... ${stored ? "stored" : "duplicate"}`,
      );
      return;
    }
    case "like": {
      const { receiveLike } = await import("./content.ts");
      const stored = receiveLike(db, inner);
      const ts = (inner.data as { ts?: number }).ts;
      if (ts) noteSeenFrom(db, fromPublicId, ts);
      console.log(
        `[friends] like from ${fromPublicId.slice(0, 12)}... ${stored ? "stored" : "duplicate"}`,
      );
      return;
    }
    case "comment": {
      const { receiveComment } = await import("./content.ts");
      const stored = receiveComment(db, inner);
      const ts = (inner.data as { ts?: number }).ts;
      if (ts) noteSeenFrom(db, fromPublicId, ts);
      console.log(
        `[friends] comment from ${fromPublicId.slice(0, 12)}... ${stored ? "stored" : "duplicate"}`,
      );
      return;
    }
    case "attachment": {
      const { receiveAttachment } = await import("./attachments.ts");
      const stored = receiveAttachment(db, attachmentsDir, inner);
      const ts = (inner.data as { ts?: number }).ts;
      if (ts) noteSeenFrom(db, fromPublicId, ts);
      console.log(
        `[friends] attachment from ${fromPublicId.slice(0, 12)}... ${stored ? "stored" : "duplicate"}`,
      );
      return;
    }
    case "sync_request": {
      const { handleSyncRequest } = await import("./sync.ts");
      handleSyncRequest(db, identity, relay, fromPublicId, inner);
      return;
    }
    case "sync_response": {
      const { handleSyncResponse } = await import("./sync.ts");
      await handleSyncResponse(db, fromPublicId, inner);
      return;
    }
    default:
      console.log(`[friends] unknown inner kind: ${(inner as any).kind}`);
      return;
  }
}

function handleIncomingRequest(
  db: Database.Database,
  identity: Identity,
  relay: RelayClient,
  fromPublicId: string,
  inner: InnerEnvelope,
  myName: string,
  handlers: HandshakeHandlers,
) {
  const data = inner.data as unknown as FriendRequestData;
  if (!verifyObject(fromPublicId, data as any, inner.sig)) {
    console.warn(`[friends] bad signature on friend_request from ${fromPublicId}`);
    return;
  }

  const existing = getFriend(db, fromPublicId);

  if (existing && existing.status === "accepted") {
    console.log(
      `[friends] duplicate friend_request from accepted friend ${fromPublicId.slice(0, 12)}... ignored`,
    );
    return;
  }

  if (existing && existing.status === "pending_out") {
    console.log(
      `[friends] we already requested ${fromPublicId.slice(0, 12)}... — auto-accepting`,
    );

    upsertFriend(db, {
      public_id: fromPublicId,
      ecdh_public: data.fromEcdh,
      name: data.name || fromPublicId.slice(0, 12),
      shared_key: existing.shared_key,
      status: "pending_out",
    });

    db.prepare(
      `INSERT OR REPLACE INTO pending_nonces (nonce, peer_public_id, direction, created_at)
       VALUES (?, ?, 'in', ?)`,
    ).run(data.nonce, fromPublicId, data.ts);

    acceptFriendRequest(db, identity, relay, fromPublicId, myName);
    return;
  }

  upsertFriend(db, {
    public_id: fromPublicId,
    ecdh_public: data.fromEcdh,
    name: data.name || fromPublicId.slice(0, 12),
    shared_key: "",
    status: "pending_in",
  });
  db.prepare(
    `INSERT OR REPLACE INTO pending_nonces (nonce, peer_public_id, direction, created_at)
     VALUES (?, ?, 'in', ?)`,
  ).run(data.nonce, fromPublicId, data.ts);

  console.log(`[friends] incoming request from ${data.name}`);
  handlers.onFriendRequest?.(fromPublicId, data.name);
}

function handleIncomingAccept(
  db: Database.Database,
  identity: Identity,
  fromPublicId: string,
  inner: InnerEnvelope,
  handlers: HandshakeHandlers,
) {
  const data = inner.data as unknown as FriendAcceptData;
  if (!verifyObject(fromPublicId, data as any, inner.sig)) {
    console.warn(`[friends] bad signature on friend_accept from ${fromPublicId}`);
    return;
  }
  const pending = db
    .prepare("SELECT * FROM pending_nonces WHERE nonce = ? AND direction = 'out'")
    .get(data.nonce) as { nonce: string; peer_public_id: string } | undefined;
  if (!pending || pending.peer_public_id !== fromPublicId) {
    console.warn(`[friends] friend_accept with unknown nonce from ${fromPublicId}`);
    return;
  }
  const sharedKey = deriveSharedKey(identity.ecdhPrivate, data.fromEcdh);
  upsertFriend(db, {
    public_id: fromPublicId,
    ecdh_public: data.fromEcdh,
    name: data.name || fromPublicId.slice(0, 12),
    shared_key: sharedKey.toString("base64"),
    status: "accepted",
  });
  db.prepare("DELETE FROM pending_nonces WHERE nonce = ?").run(data.nonce);
  console.log(`[friends] accepted: ${data.name}`);
  handlers.onFriendAccepted?.(fromPublicId, data.name);
}

function handleIncomingDecline(
  db: Database.Database,
  fromPublicId: string,
  inner: InnerEnvelope,
) {
  const data = inner.data as unknown as FriendDeclineData;
  if (!verifyObject(fromPublicId, data as any, inner.sig)) return;
  db.prepare("DELETE FROM friends WHERE public_id = ?").run(fromPublicId);
  db.prepare("DELETE FROM pending_nonces WHERE nonce = ?").run(data.nonce);
}

function handleUnfriend(db: Database.Database, fromPublicId: string) {
  db.prepare("DELETE FROM friends WHERE public_id = ?").run(fromPublicId);
  console.log(`[friends] unfriended by ${fromPublicId.slice(0, 12)}...`);
}
