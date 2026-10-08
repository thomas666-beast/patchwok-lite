// Patchwork Lite — posts, likes, comments

import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import type { Identity } from "../crypto/identity.ts";
import type { RelayClient } from "../relay/client.ts";
import { sign, verify, canonical } from "../crypto/identity.ts";
import { seal } from "../crypto/envelope.ts";
import {
  InnerEnvelope,
  PostData,
  LikeData,
  CommentData,
  AttachmentRef,
} from "../../../shared/protocol.ts";
import { getSharedKey, listFriends } from "./friends.ts";

export function hashEnvelope(inner: InnerEnvelope): string {
  const payload = canonical({ kind: inner.kind, data: inner.data });
  return createHash("sha256")
    .update(payload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sealFor(inner: InnerEnvelope, sharedKey: Buffer): string {
  return Buffer.from(JSON.stringify(seal(inner, sharedKey)), "utf8").toString("base64");
}

function sendToAllFriends(
  db: Database.Database,
  relay: RelayClient,
  inner: InnerEnvelope,
): number {
  let sent = 0;
  for (const f of listFriends(db)) {
    const key = getSharedKey(db, f.public_id);
    if (!key) continue;
    relay.sendBlob(f.public_id, sealFor(inner, key));
    sent++;
  }
  return sent;
}

export function createPost(
  db: Database.Database,
  identity: Identity,
  relay: RelayClient,
  text: string,
  attachments?: AttachmentRef[],
) {
  const data: PostData = {
    author: identity.publicId,
    text: text ?? "",
    ts: Date.now(),
    ...(attachments && attachments.length ? { attachments } : {}),
  };
  const sig = sign(identity.signPrivate, canonical(data));
  const inner: InnerEnvelope = { kind: "post", data: data as any, sig };
  const id = hashEnvelope(inner);

  db.prepare(
    `INSERT OR IGNORE INTO posts (id, author, ts, text, sig, received_at, attachments)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    identity.publicId,
    data.ts,
    data.text,
    sig,
    Date.now(),
    JSON.stringify(attachments ?? []),
  );

  const sent = sendToAllFriends(db, relay, inner);
  console.log(`[content] post ${id.slice(0, 12)}... sent to ${sent} friend(s)`);
  return { id, recipients: sent };
}

export function createLike(
  db: Database.Database,
  identity: Identity,
  relay: RelayClient,
  targetPostId: string,
) {
  const data: LikeData = { author: identity.publicId, target: targetPostId, ts: Date.now() };
  const sig = sign(identity.signPrivate, canonical(data));
  const inner: InnerEnvelope = { kind: "like", data: data as any, sig };
  const id = hashEnvelope(inner);

  db.prepare(
    `INSERT OR IGNORE INTO likes (id, author, target, ts, sig, received_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, identity.publicId, targetPostId, data.ts, sig, Date.now());

  const sent = sendToAllFriends(db, relay, inner);
  return { id, recipients: sent };
}

export function createComment(
  db: Database.Database,
  identity: Identity,
  relay: RelayClient,
  targetPostId: string,
  text: string,
) {
  const data: CommentData = {
    author: identity.publicId,
    target: targetPostId,
    text,
    ts: Date.now(),
  };
  const sig = sign(identity.signPrivate, canonical(data));
  const inner: InnerEnvelope = { kind: "comment", data: data as any, sig };
  const id = hashEnvelope(inner);

  db.prepare(
    `INSERT OR IGNORE INTO comments (id, author, target, text, ts, sig, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, identity.publicId, targetPostId, text, data.ts, sig, Date.now());

  const sent = sendToAllFriends(db, relay, inner);
  return { id, recipients: sent };
}

export function receivePost(db: Database.Database, inner: InnerEnvelope): boolean {
  const data = inner.data as unknown as PostData;
  if (!verify(data.author, canonical(data), inner.sig)) {
    console.warn(`[content] bad signature on post`);
    return false;
  }
  const id = hashEnvelope(inner);
  const result = db.prepare(
    `INSERT OR IGNORE INTO posts (id, author, ts, text, sig, received_at, attachments)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    data.author,
    data.ts,
    data.text,
    inner.sig,
    Date.now(),
    JSON.stringify(data.attachments ?? []),
  );
  return result.changes > 0;
}

export function receiveLike(db: Database.Database, inner: InnerEnvelope): boolean {
  const data = inner.data as unknown as LikeData;
  if (!verify(data.author, canonical(data), inner.sig)) return false;
  const id = hashEnvelope(inner);
  const result = db.prepare(
    `INSERT OR IGNORE INTO likes (id, author, target, ts, sig, received_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, data.author, data.target, data.ts, inner.sig, Date.now());
  return result.changes > 0;
}

export function receiveComment(db: Database.Database, inner: InnerEnvelope): boolean {
  const data = inner.data as unknown as CommentData;
  if (!verify(data.author, canonical(data), inner.sig)) return false;
  const id = hashEnvelope(inner);
  const result = db.prepare(
    `INSERT OR IGNORE INTO comments (id, author, target, text, ts, sig, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, data.author, data.target, data.text, data.ts, inner.sig, Date.now());
  return result.changes > 0;
}

export interface FeedPost {
  id: string;
  author: string;
  ts: number;
  text: string;
  likes: number;
  comments: number;
  attachments: AttachmentRef[];
}

export function listFeed(db: Database.Database, limit = 50): FeedPost[] {
  const rows = db
    .prepare(
      `SELECT id, author, ts, text, attachments FROM posts ORDER BY ts DESC LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    author: string;
    ts: number;
    text: string;
    attachments: string;
  }>;
  return rows.map((r) => {
    const likes = (
      db.prepare("SELECT COUNT(*) as n FROM likes WHERE target = ?").get(r.id) as { n: number }
    ).n;
    const comments = (
      db.prepare("SELECT COUNT(*) as n FROM comments WHERE target = ?").get(r.id) as { n: number }
    ).n;
    return {
      id: r.id,
      author: r.author,
      ts: r.ts,
      text: r.text,
      likes,
      comments,
      attachments: JSON.parse(r.attachments ?? "[]"),
    };
  });
}

export function getPostWithThread(db: Database.Database, postId: string) {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(postId) as any;
  if (!post) return null;
  post.attachments = JSON.parse(post.attachments ?? "[]");
  const likes = db.prepare("SELECT * FROM likes WHERE target = ? ORDER BY ts").all(postId);
  const comments = db
    .prepare("SELECT * FROM comments WHERE target = ? ORDER BY ts")
    .all(postId);
  return { post, likes, comments };
}
