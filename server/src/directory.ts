// Patchwork Lite — server directory

import { createPublicKey, createVerify } from "node:crypto";
import { SignedProfile, canonical } from "../../shared/protocol.ts";

const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PROFILES = 10_000;

interface Entry {
  profile: SignedProfile;
  expiresAt: number;
  lastSeen: number;
}

const profiles = new Map<string, Entry>();

function verifyProfile(sp: SignedProfile): boolean {
  try {
    const pub = createPublicKey({
      key: Buffer.from(sp.data.publicId, "base64"),
      format: "der",
      type: "spki",
    });
    const v = createVerify("SHA256");
    v.update(canonical(sp.data));
    v.end();
    return v.verify(pub, Buffer.from(sp.sig, "base64"));
  } catch {
    return false;
  }
}

export function putProfile(sp: SignedProfile): boolean {
  if (!verifyProfile(sp)) return false;
  const existing = profiles.get(sp.data.publicId);
  if (existing && existing.profile.data.ts > sp.data.ts) return false;

  if (profiles.size >= MAX_PROFILES && !existing) {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [k, v] of profiles) {
      if (v.lastSeen < oldestTs) {
        oldestTs = v.lastSeen;
        oldestKey = k;
      }
    }
    if (oldestKey) profiles.delete(oldestKey);
  }

  profiles.set(sp.data.publicId, {
    profile: sp,
    expiresAt: Date.now() + PROFILE_TTL_MS,
    lastSeen: Date.now(),
  });
  return true;
}

export function searchProfiles(query: string, limit = 50): SignedProfile[] {
  const q = query.trim().toLowerCase();
  const now = Date.now();
  const results: SignedProfile[] = [];

  for (const entry of profiles.values()) {
    if (entry.expiresAt < now) continue;
    const p = entry.profile.data;
    const hay = `${p.name} ${p.description} ${p.tags.join(" ")}`.toLowerCase();
    if (!q || hay.includes(q)) {
      if (verifyProfile(entry.profile)) results.push(entry.profile);
      if (results.length >= limit) break;
    }
  }
  results.sort((a, b) => b.data.ts - a.data.ts);
  return results;
}

export function startDirectorySweep() {
  setInterval(() => {
    const now = Date.now();
    for (const [id, e] of profiles) if (e.expiresAt < now) profiles.delete(id);
  }, 60 * 1000);
}

export function directorySize() {
  return profiles.size;
}
