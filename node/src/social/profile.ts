// Patchwork Lite — public signed profile

import type { Identity } from "../crypto/identity.ts";
import type { RelayClient } from "../relay/client.ts";
import { sign } from "../crypto/identity.ts";
import { ProfileData, SignedProfile, canonical } from "../../../shared/protocol.ts";

export interface ProfileInput {
  name: string;
  description: string;
  tags: string[];
}

export function buildProfile(identity: Identity, input: ProfileInput): SignedProfile {
  const data: ProfileData = {
    publicId: identity.publicId,
    ecdhPublic: identity.ecdhPublic,
    name: input.name.trim(),
    description: input.description.trim(),
    tags: input.tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
    ts: Date.now(),
  };
  const sig = sign(identity.signPrivate, canonical(data));
  return { data, sig };
}

export function publishProfile(relay: RelayClient, sp: SignedProfile) {
  relay.publishProfile(sp);
}

export function searchProfiles(relay: RelayClient, query: string, limit = 50) {
  return relay.searchProfiles(query, limit);
}
