// Patchwork Lite — local node

import { resolve } from "node:path";
import {
  openDb,
  hasIdentity,
  createAndStoreIdentity,
  loadIdentity,
  getLocalProfile,
} from "./crypto/keystore.ts";
import { RelayClient } from "./relay/client.ts";
import { handleInner, getFriend, listFriends } from "./social/friends.ts";
import { buildProfile, publishProfile } from "./social/profile.ts";
import { sendSyncRequest } from "./social/sync.ts";
import { startApi } from "./api.ts";
import { bus } from "./events.ts";

const NODE_ID =
  process.env.PW_NODE_ID ?? "node-" + Math.random().toString(36).slice(2, 8);
const MY_NAME = process.env.PW_NAME ?? NODE_ID;
const PASSPHRASE = process.env.PW_PASSPHRASE ?? "test-passphrase";
const DB_DIR = process.env.PW_DATA_DIR ?? "data";
const API_PORT = Number(process.env.PW_API_PORT ?? 7701);
const SERVER_URLS = (
  process.env.PW_SERVERS ??
  process.env.PW_SERVER ??
  "ws://localhost:7700"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const DB_PATH = resolve(process.cwd(), DB_DIR, "node.sqlite");
const ATTACHMENTS_DIR = resolve(process.cwd(), DB_DIR, "attachments");

console.log(`[node ${NODE_ID}] started`);
console.log(`[node ${NODE_ID}] name: ${MY_NAME}`);
console.log(`[node ${NODE_ID}] data dir: ${DB_DIR}`);
console.log(`[node ${NODE_ID}] servers: ${SERVER_URLS.join(", ")}`);
console.log(`[node ${NODE_ID}] db: ${DB_PATH}`);
console.log(`[node ${NODE_ID}] attachments: ${ATTACHMENTS_DIR}`);

const db = openDb(DB_PATH);

const identity = hasIdentity(db)
  ? loadIdentity(db, PASSPHRASE)
  : createAndStoreIdentity(db, PASSPHRASE);

console.log(`[node ${NODE_ID}] fullPublicId: ${identity.publicId}`);

const relay = new RelayClient(SERVER_URLS, identity, {
  onOpen: (url) => {
    console.log(`[node ${NODE_ID}] connected to ${url}`);
    // Ask every accepted friend for anything we may have missed.
    for (const f of listFriends(db)) {
      sendSyncRequest(db, identity, relay, f.public_id);
    }
  },
  onClose: (url) => console.log(`[node ${NODE_ID}] disconnected from ${url}`),
  onPresence: (publicId) => {
    console.log(`[node ${NODE_ID}] peer online: ${publicId.slice(0, 16)}...`);
    const friend = getFriend(db, publicId);
    if (friend && friend.status === "accepted") {
      sendSyncRequest(db, identity, relay, publicId);
    }
  },
  onBlob: async (from, id, payload, ts) => {
    await handleInner(
      db,
      identity,
      relay,
      from,
      payload,
      MY_NAME,
      ATTACHMENTS_DIR,
      {
        onFriendRequest: (pub, name) => {
          console.log(
            `[node ${NODE_ID}] friend request from ${name} (${pub.slice(0, 12)}...)`,
          );
          bus.emit("event", { type: "friends_changed", data: {} });
        },
        onFriendAccepted: (pub, name) => {
          console.log(
            `[node ${NODE_ID}] friend accepted: ${name} (${pub.slice(0, 12)}...)`,
          );
          bus.emit("event", { type: "friends_changed", data: {} });
        },
      },
    );
    bus.emit("event", { type: "feed_changed", data: {} });
  },
});

startApi(API_PORT, {
  db,
  identity,
  relay,
  myName: MY_NAME,
  nodeId: NODE_ID,
  attachmentsDir: ATTACHMENTS_DIR,
});

relay.connectAll();

const saved = getLocalProfile(db);
if (saved) {
  const sp = buildProfile(identity, {
    name: saved.name,
    description: saved.description,
    tags: saved.tags,
  });
  publishProfile(relay, sp);
  console.log(`[node ${NODE_ID}] published profile: ${saved.name}`);
}

process.on("SIGINT", () => {
  console.log(`[node ${NODE_ID}] shutting down`);
  relay.close();
  process.exit(0);
});
