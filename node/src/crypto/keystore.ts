// Patchwork Lite — keystore
// Persists identity, profile, and content to SQLite.

import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import {
  randomBytes,
  pbkdf2Sync,
  createCipheriv,
  createDecipheriv,
  KeyObject,
  createPrivateKey,
} from "node:crypto";

import { generateIdentity, Identity } from "./identity.ts";

const PBKDF2_ITERATIONS = 100_000;
const KEY_LEN = 32;
const SALT_LEN = 16;
const NONCE_LEN = 12;

interface StoredIdentityRow {
  public_id: string;
  ecdh_public: string;
  salt: Buffer;
  nonce: Buffer;
  ciphertext: Buffer;
}

export function openDb(path: string): Database.Database {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS identity (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      public_id TEXT NOT NULL,
      ecdh_public TEXT NOT NULL,
      salt BLOB NOT NULL,
      nonce BLOB NOT NULL,
      ciphertext BLOB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friends (
      public_id TEXT PRIMARY KEY,
      ecdh_public TEXT NOT NULL,
      name TEXT NOT NULL,
      shared_key TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_nonces (
      nonce TEXT PRIMARY KEY,
      peer_public_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      ts INTEGER NOT NULL,
      text TEXT NOT NULL,
      sig TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      attachments TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS likes (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      target TEXT NOT NULL,
      ts INTEGER NOT NULL,
      sig TEXT NOT NULL,
      received_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      target TEXT NOT NULL,
      text TEXT NOT NULL,
      ts INTEGER NOT NULL,
      sig TEXT NOT NULL,
      received_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      tags TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS peer_sync_state (
      public_id TEXT PRIMARY KEY,
      last_seen_ts INTEGER NOT NULL,
      last_sync_ts INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attachments (
      hash TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      mime TEXT NOT NULL,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      local_path TEXT NOT NULL,
      nonce TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      file_key TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_posts_ts ON posts (ts DESC);
    CREATE INDEX IF NOT EXISTS idx_likes_target ON likes (target);
    CREATE INDEX IF NOT EXISTS idx_comments_target ON comments (target);
    CREATE INDEX IF NOT EXISTS idx_attachments_author ON attachments (author);
  `);
  return db;
}

export function hasIdentity(db: Database.Database): boolean {
  const row = db.prepare("SELECT COUNT(*) as n FROM identity").get() as { n: number };
  return row.n > 0;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LEN, "sha256");
}

function encryptString(plaintext: string, key: Buffer) {
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { nonce, ciphertext: Buffer.concat([enc, tag]) };
}

function decryptString(ciphertext: Buffer, nonce: Buffer, key: Buffer): string {
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const enc = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

export function createAndStoreIdentity(
  db: Database.Database,
  passphrase: string,
): Identity {
  const id = generateIdentity();
  const signPem = id.signPrivate.export({ type: "pkcs8", format: "pem" }).toString();
  const ecdhPem = id.ecdhPrivate.export({ type: "pkcs8", format: "pem" }).toString();
  const bundle = JSON.stringify({ signPem, ecdhPem });
  const salt = randomBytes(SALT_LEN);
  const key = deriveKey(passphrase, salt);
  const { nonce, ciphertext } = encryptString(bundle, key);
  db.prepare(
    `INSERT INTO identity (id, public_id, ecdh_public, salt, nonce, ciphertext)
     VALUES (1, ?, ?, ?, ?, ?)`,
  ).run(id.publicId, id.ecdhPublic, salt, nonce, ciphertext);
  return id;
}

export function loadIdentity(db: Database.Database, passphrase: string): Identity {
  const row = db
    .prepare("SELECT * FROM identity WHERE id = 1")
    .get() as StoredIdentityRow | undefined;
  if (!row) throw new Error("no identity stored");
  const key = deriveKey(passphrase, row.salt);
  const bundleJson = decryptString(row.ciphertext, row.nonce, key);
  const bundle = JSON.parse(bundleJson) as { signPem: string; ecdhPem: string };
  const signPrivate: KeyObject = createPrivateKey(bundle.signPem);
  const ecdhPrivate: KeyObject = createPrivateKey(bundle.ecdhPem);
  return {
    publicId: row.public_id,
    ecdhPublic: row.ecdh_public,
    signPrivate,
    ecdhPrivate,
  };
}

export function exportBackup(db: Database.Database): string {
  const row = db
    .prepare("SELECT * FROM identity WHERE id = 1")
    .get() as StoredIdentityRow | undefined;
  if (!row) throw new Error("no identity to export");
  const bundle = {
    publicId: row.public_id,
    ecdhPublic: row.ecdh_public,
    salt: row.salt.toString("base64"),
    nonce: row.nonce.toString("base64"),
    ciphertext: row.ciphertext.toString("base64"),
  };
  return Buffer.from(JSON.stringify(bundle), "utf8").toString("base64");
}

export function importBackup(db: Database.Database, backupBase64: string): void {
  const bundle = JSON.parse(
    Buffer.from(backupBase64, "base64").toString("utf8"),
  ) as {
    publicId: string;
    ecdhPublic: string;
    salt: string;
    nonce: string;
    ciphertext: string;
  };
  db.prepare("DELETE FROM identity").run();
  db.prepare(
    `INSERT INTO identity (id, public_id, ecdh_public, salt, nonce, ciphertext)
     VALUES (1, ?, ?, ?, ?, ?)`,
  ).run(
    bundle.publicId,
    bundle.ecdhPublic,
    Buffer.from(bundle.salt, "base64"),
    Buffer.from(bundle.nonce, "base64"),
    Buffer.from(bundle.ciphertext, "base64"),
  );
}

// ---------- Local profile ----------

export interface LocalProfile {
  name: string;
  description: string;
  tags: string[];
  updatedAt: number;
}

export function getLocalProfile(db: Database.Database): LocalProfile | null {
  const row = db.prepare("SELECT * FROM profile WHERE id = 1").get() as
    | { name: string; description: string; tags: string; updated_at: number }
    | undefined;
  if (!row) return null;
  return {
    name: row.name,
    description: row.description,
    tags: JSON.parse(row.tags),
    updatedAt: row.updated_at,
  };
}

export function setLocalProfile(
  db: Database.Database,
  p: Omit<LocalProfile, "updatedAt">,
) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO profile (id, name, description, tags, updated_at)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       tags = excluded.tags,
       updated_at = excluded.updated_at`,
  ).run(p.name, p.description, JSON.stringify(p.tags), now);
}

// ---------- Peer sync state ----------

export function getPeerSyncState(
  db: Database.Database,
  publicId: string,
): { last_seen_ts: number; last_sync_ts: number } {
  const row = db
    .prepare("SELECT last_seen_ts, last_sync_ts FROM peer_sync_state WHERE public_id = ?")
    .get(publicId) as { last_seen_ts: number; last_sync_ts: number } | undefined;
  return row ?? { last_seen_ts: 0, last_sync_ts: 0 };
}

export function setPeerSyncState(
  db: Database.Database,
  publicId: string,
  patch: Partial<{ last_seen_ts: number; last_sync_ts: number }>,
) {
  const current = getPeerSyncState(db, publicId);
  const next = {
    last_seen_ts: patch.last_seen_ts ?? current.last_seen_ts,
    last_sync_ts: patch.last_sync_ts ?? current.last_sync_ts,
  };
  db.prepare(
    `INSERT INTO peer_sync_state (public_id, last_seen_ts, last_sync_ts)
     VALUES (?, ?, ?)
     ON CONFLICT(public_id) DO UPDATE SET
       last_seen_ts = excluded.last_seen_ts,
       last_sync_ts = excluded.last_sync_ts`,
  ).run(publicId, next.last_seen_ts, next.last_sync_ts);
}
