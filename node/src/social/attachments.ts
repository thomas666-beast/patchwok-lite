// Patchwork Lite — attachment storage

import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import type { Identity } from "../crypto/identity.ts";
import type { RelayClient } from "../relay/client.ts";
import { sign, verify, canonical } from "../crypto/identity.ts";
import { encryptBytes, decryptBytes, seal } from "../crypto/envelope.ts";
import {
  AttachmentRef,
  InnerEnvelope,
} from "../../../shared/protocol.ts";
import { getSharedKey, listFriends } from "./friends.ts";

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function filePathFor(dir: string, hash: string): string {
  const safe = hash.replace(/[^A-Za-z0-9_-]/g, "_");
  return join(dir, safe);
}

function sha256Base64Url(data: Buffer): string {
  return createHash("sha256")
    .update(data)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ---------- outgoing ----------

export interface SendAttachmentInput {
  attachmentsDir: string;
  filename: string;
  mime: string;
  bytes: Buffer;
}

export function sendAttachment(
  db: Database.Database,
  identity: Identity,
  relay: RelayClient,
  input: SendAttachmentInput,
): AttachmentRef | null {
  const friends = listFriends(db).filter((f) => f.status === "accepted");
  if (friends.length === 0) {
    console.warn("[attachments] no friends to send to");
    return null;
  }

  const fileKey = randomBytes(32);
  const { nonce, ciphertext } = encryptBytes(input.bytes, fileKey);
  const hash = sha256Base64Url(ciphertext);

  ensureDir(input.attachmentsDir);
  const path = filePathFor(input.attachmentsDir, hash);
  writeFileSync(path, ciphertext);

  db.prepare(
    `INSERT OR IGNORE INTO attachments
     (hash, author, mime, name, size, local_path, nonce, received_at, file_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    hash,
    identity.publicId,
    input.mime,
    input.filename,
    ciphertext.length,
    path,
    nonce.toString("base64"),
    Date.now(),
    fileKey.toString("base64"),
  );

  const payloadBase64 = ciphertext.toString("base64");
  for (const f of friends) {
    const sharedKey = getSharedKey(db, f.public_id);
    if (!sharedKey) continue;

    const data = {
      author: identity.publicId,
      hash,
      mime: input.mime,
      name: input.filename,
      size: ciphertext.length,
      payload: payloadBase64,
      fileKey: fileKey.toString("base64"),
      nonce: nonce.toString("base64"),
      ts: Date.now(),
    };
    const sig = sign(identity.signPrivate, canonical(data));
    const inner: InnerEnvelope = { kind: "attachment", data, sig };
    const sealed = seal(inner, sharedKey);
    const envelope = Buffer.from(JSON.stringify(sealed), "utf8").toString("base64");
    relay.sendBlob(f.public_id, envelope);
  }

  return {
    hash,
    mime: input.mime,
    name: input.filename,
    size: ciphertext.length,
  };
}

// ---------- incoming ----------

export function receiveAttachment(
  db: Database.Database,
  attachmentsDir: string,
  inner: InnerEnvelope,
): boolean {
  const data = inner.data as unknown as {
    author: string;
    hash: string;
    mime: string;
    name: string;
    size: number;
    payload: string;
    fileKey: string;
    nonce: string;
    ts: number;
  };

  if (!verify(data.author, canonical(data), inner.sig)) {
    console.warn(
      `[attachments] bad signature on attachment from ${data.author.slice(0, 12)}...`,
    );
    return false;
  }

  ensureDir(attachmentsDir);
  const path = filePathFor(attachmentsDir, data.hash);

  if (!existsSync(path)) {
    writeFileSync(path, Buffer.from(data.payload, "base64"));
  }

  const result = db.prepare(
    `INSERT OR IGNORE INTO attachments
     (hash, author, mime, name, size, local_path, nonce, received_at, file_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    data.hash,
    data.author,
    data.mime,
    data.name,
    data.size,
    path,
    data.nonce,
    Date.now(),
    data.fileKey,
  );

  return result.changes > 0;
}

// ---------- reading ----------

export function readAttachment(
  db: Database.Database,
  hash: string,
): { mime: string; name: string; bytes: Buffer } | null {
  const row = db
    .prepare("SELECT * FROM attachments WHERE hash = ?")
    .get(hash) as
    | {
        mime: string;
        name: string;
        local_path: string;
        nonce: string;
        file_key: string;
      }
    | undefined;
  if (!row) return null;

  const ciphertext = readFileSync(row.local_path);
  const fileKey = Buffer.from(row.file_key, "base64");
  const nonce = Buffer.from(row.nonce, "base64");
  const bytes = decryptBytes(ciphertext, nonce, fileKey);
  return { mime: row.mime, name: row.name, bytes };
}
