// Patchwork Lite — sealed envelope

import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from "node:crypto";
import type { InnerEnvelope } from "../../../shared/protocol.ts";

const VERSION = 1;
const NONCE_LEN = 12;

export interface SealedEnvelope {
  v: number;
  nonce: string;
  ciphertext: string;
}

export function seal(inner: InnerEnvelope, sharedKey: Buffer): SealedEnvelope {
  const plaintext = Buffer.from(JSON.stringify(inner), "utf8");
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv("aes-256-gcm", sharedKey, nonce);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([enc, tag]);
  return {
    v: VERSION,
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function unseal(sealed: SealedEnvelope, sharedKey: Buffer): InnerEnvelope {
  if (sealed.v !== VERSION) throw new Error("unsupported envelope version");
  const nonce = Buffer.from(sealed.nonce, "base64");
  const data = Buffer.from(sealed.ciphertext, "base64");
  const tag = data.subarray(data.length - 16);
  const enc = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", sharedKey, nonce);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString("utf8")) as InnerEnvelope;
}

export function looksSealed(base64Payload: string): boolean {
  try {
    const obj = JSON.parse(Buffer.from(base64Payload, "base64").toString("utf8"));
    return (
      obj &&
      typeof obj === "object" &&
      typeof obj.v === "number" &&
      typeof obj.nonce === "string" &&
      typeof obj.ciphertext === "string"
    );
  } catch {
    return false;
  }
}

// ---------- Attachments ----------

export function attachmentKey(sharedKey: Buffer, hashBase64: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      sharedKey,
      Buffer.alloc(0),
      Buffer.from("attachment:" + hashBase64),
      32,
    ),
  );
}

export function encryptBytes(
  plaintext: Buffer,
  key: Buffer,
): { nonce: Buffer; ciphertext: Buffer } {
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { nonce, ciphertext: Buffer.concat([enc, tag]) };
}

export function decryptBytes(
  ciphertext: Buffer,
  nonce: Buffer,
  key: Buffer,
): Buffer {
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const enc = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}
