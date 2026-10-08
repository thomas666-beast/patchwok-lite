// Patchwork Lite — sync between friends

import Database from "better-sqlite3";
import type { Identity } from "../crypto/identity.ts";
import type { RelayClient } from "../relay/client.ts";
import { sign } from "../crypto/identity.ts";
import { seal } from "../crypto/envelope.ts";
import {
  InnerEnvelope,
  SyncRequestData,
  SyncResponseData,
  SyncItem,
  canonical,
} from "../../../shared/protocol.ts";
import { getSharedKey } from "./friends.ts";
import { getPeerSyncState, setPeerSyncState } from "../crypto/keystore.ts";

const MIN_SYNC_INTERVAL_MS = 30_000;
const MAX_ITEMS_PER_RESPONSE = 500;
const MAX_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

export function sendSyncRequest(
  db: Database.Database,
  identity: Identity,
  relay: RelayClient,
  toPublicId: string,
): boolean {
  const key = getSharedKey(db, toPublicId);
  if (!key) return false;

  const state = getPeerSyncState(db, toPublicId);
  const now = Date.now();

  if (now - state.last_sync_ts < MIN_SYNC_INTERVAL_MS) return false;

  const since = Math.max(state.last_seen_ts, now - MAX_LOOKBACK_MS);

  const data: SyncRequestData = {
    from: identity.publicId,
    since,
    ts: now,
  };
  const sig = sign(identity.signPrivate, canonical(data));
  const inner: InnerEnvelope = { kind: "sync_request", data: data as any, sig };

  const sealed = seal(inner, key);
  const payload = Buffer.from(JSON.stringify(sealed), "utf8").toString("base64");
  relay.sendBlob(toPublicId, payload);

  setPeerSyncState(db, toPublicId, { last_sync_ts: now });
  console.log(
    `[sync] requested from ${toPublicId.slice(0, 12)}... since ${new Date(since).toISOString()}`,
  );
  return true;
}

export function handleSyncRequest(
  db: Database.Database,
  identity: Identity,
  relay: RelayClient,
  fromPublicId: string,
  inner: InnerEnvelope,
): void {
  const key = getSharedKey(db, fromPublicId);
  if (!key) return;

  const data = inner.data as unknown as SyncRequestData;
  const items = collectSince(db, data.since);

  const response: SyncResponseData = {
    from: identity.publicId,
    since: data.since,
    items,
    ts: Date.now(),
  };
  const sig = sign(identity.signPrivate, canonical(response));
  const reply: InnerEnvelope = {
    kind: "sync_response",
    data: response as any,
    sig,
  };

  const sealed = seal(reply, key);
  const payload = Buffer.from(JSON.stringify(sealed), "utf8").toString("base64");
  relay.sendBlob(fromPublicId, payload);
  console.log(`[sync] sent ${items.length} item(s) to ${fromPublicId.slice(0, 12)}...`);
}

export async function handleSyncResponse(
  db: Database.Database,
  fromPublicId: string,
  inner: InnerEnvelope,
): Promise<void> {
  const data = inner.data as unknown as SyncResponseData;

  const { receivePost, receiveLike, receiveComment } = await import("./content.ts");

  let added = 0;
  let newest = 0;
  for (const item of data.items) {
    let stored = false;
    if (item.kind === "post") stored = receivePost(db, item.inner);
    else if (item.kind === "like") stored = receiveLike(db, item.inner);
    else if (item.kind === "comment") stored = receiveComment(db, item.inner);
    if (stored) added++;

    const ts = (item.inner.data as { ts?: number }).ts;
    if (ts && ts > newest) newest = ts;
  }

  if (newest > 0) {
    const state = getPeerSyncState(db, fromPublicId);
    if (newest > state.last_seen_ts) {
      setPeerSyncState(db, fromPublicId, { last_seen_ts: newest });
    }
  }

  console.log(
    `[sync] received ${data.items.length} item(s) from ${fromPublicId.slice(0, 12)}..., stored ${added} new`,
  );
}

function collectSince(db: Database.Database, since: number): SyncItem[] {
  const items: SyncItem[] = [];

  const posts = db
    .prepare("SELECT * FROM posts WHERE ts > ? ORDER BY ts ASC LIMIT ?")
    .all(since, MAX_ITEMS_PER_RESPONSE) as Array<{
    id: string;
    author: string;
    ts: number;
    text: string;
    sig: string;
    attachments: string;
  }>;

  for (const p of posts) {
    items.push({
      kind: "post",
      inner: {
        kind: "post",
        data: {
          author: p.author,
          text: p.text,
          ts: p.ts,
          attachments: JSON.parse(p.attachments ?? "[]"),
        },
        sig: p.sig,
      },
    });
  }

  const likes = db
    .prepare("SELECT * FROM likes WHERE ts > ? ORDER BY ts ASC LIMIT ?")
    .all(since, MAX_ITEMS_PER_RESPONSE) as Array<{
    id: string;
    author: string;
    target: string;
    ts: number;
    sig: string;
  }>;
  for (const l of likes) {
    items.push({
      kind: "like",
      inner: {
        kind: "like",
        data: { author: l.author, target: l.target, ts: l.ts },
        sig: l.sig,
      },
    });
  }

  const comments = db
    .prepare("SELECT * FROM comments WHERE ts > ? ORDER BY ts ASC LIMIT ?")
    .all(since, MAX_ITEMS_PER_RESPONSE) as Array<{
    id: string;
    author: string;
    target: string;
    text: string;
    ts: number;
    sig: string;
  }>;
  for (const c of comments) {
    items.push({
      kind: "comment",
      inner: {
        kind: "comment",
        data: { author: c.author, target: c.target, text: c.text, ts: c.ts },
        sig: c.sig,
      },
    });
  }

  items.sort((a, b) => (a.inner.data as any).ts - (b.inner.data as any).ts);
  return items.slice(0, MAX_ITEMS_PER_RESPONSE);
}
