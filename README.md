# Patchwork Lite

A small, from-scratch, peer-to-peer social network.
Every user runs their own **node** (their data, their keys, their friend graph).
Nodes talk to each other **through one or more servers** that only see ciphertext.
The **client** is a Vue 3 app that talks to its own local node over `localhost`.

No IPFS. No WebRTC. No libp2p. No SSB. All first-party code.

---

## Architecture

```
[Vue client]  ──HTTP/WS──►  [Local node]  ──WS──►  [Server 1]
                                 │                  [Server 2]
                                 │  owns:            [Server 3]
                                 │   - identity
                                 │   - friend graph     │
                                 │   - posts, likes,    │  owns:
                                 │     comments         │   - routing table
                                 │   - encrypted keys   │   - temp. blob queue
                                 │   - offline queue    │   - public signed profiles
                                 ▼                      ▼
                          node/data/node.sqlite     in-memory only
```

- **Node** = the real peer. Persistent. Owns everything.
- **Server** = a switchboard. Forwards ciphertext, holds undelivered blobs briefly,
  indexes public signed profiles. Holds **nothing readable** and **nothing permanent**.
- **Client** = UI. Talks only to its own node.
- **End-to-end encryption** between friends via ECDH + HKDF → AES-256-GCM.

---

## Repository layout

```
patchwork-lite/
├── shared/
│   └── protocol.ts        # wire format shared by node and server
├── node/                  # per-user node (identity, DB, relay client, API)
│   ├── data/              # per-instance DB (gitignored)
│   ├── scripts/
│   │   ├── ctl.mjs        # optional CLI to the old JSON socket (deprecated)
│   │   └── dev-multi.mjs  # spawn several nodes for local testing
│   └── src/
│       ├── api.ts         # local HTTP + WebSocket API for the Vue client
│       ├── events.ts      # internal event bus
│       ├── index.ts       # entrypoint
│       ├── crypto/
│       │   ├── identity.ts
│       │   ├── keystore.ts
│       │   └── envelope.ts
│       ├── relay/
│       │   └── client.ts
│       └── social/
│           ├── friends.ts
│           ├── content.ts
│           └── profile.ts
├── server/                # relay server
│   └── src/
│       ├── index.ts
│       └── directory.ts
├── client/                # Vue 3 UI
│   └── src/
│       ├── api/node.ts
│       ├── store/
│       ├── views/
│       └── router.ts
├── instances/             # env files per node / server
│   ├── nodes/
│   │   ├── peer1.env
│   │   └── peer2.env
│   └── servers/
│       ├── server1.env
│       └── server2.env
└── scripts/
    ├── load-env.mjs
    ├── run-node.mjs
    └── run-server.mjs
```

---

## Running the stack

### Prerequisites

- **Node 20+** (`node -v`)
- npm

### One-time setup

```bash
# from the repo root
npm install          # installs root scripts' deps (none, but keeps npm happy)
cd server && npm install && cd ..
cd node   && npm install && cd ..
cd client && npm install && cd ..
```

### Define your instances

`instances/servers/server1.env`
```
PW_SERVER_ID=server1
PORT=7700
```

`instances/servers/server2.env`
```
PW_SERVER_ID=server2
PORT=7701
```

`instances/nodes/peer1.env`
```
PW_NODE_ID=peer1
PW_NAME=Alice
PW_DATA_DIR=data/peer1
PW_PASSPHRASE=pass-a
PW_API_PORT=7801
PW_SERVERS=ws://localhost:7700,ws://localhost:7701
```

`instances/nodes/peer2.env`
```
PW_NODE_ID=peer2
PW_NAME=Bob
PW_DATA_DIR=data/peer2
PW_PASSPHRASE=pass-b
PW_API_PORT=7802
PW_SERVERS=ws://localhost:7700,ws://localhost:7701
```

### Start everything

From the repo root — **three terminals**:

```bash
# Terminal 1
npm run server server1

# Terminal 2
npm run server server2      # optional, for multi-server resilience

# Terminal 3
npm run node peer1

# Terminal 4
npm run node peer2          # to test two peers
```

Then, for each node, start a client pointed at its API port. From `client/`:

```bash
# Client A → node peer1
VITE_NODE_URL=http://127.0.0.1:7801 npm run dev -- --port 5173

# Client B → node peer2
VITE_NODE_URL=http://127.0.0.1:7802 npm run dev -- --port 5174
```

Or add a root script:

```json
"client": "cd client && npm run dev"
```
and pass `VITE_NODE_URL` / `--port` as needed.

### What you should see

- Each node prints its `fullPublicId` on startup — that's the user's identity.
- Each node connects to every server listed in `PW_SERVERS`.
- Open the client → **Identity** shows the public ID.
- **Discover** finds other nodes once they've saved a public profile.
- **Friends** shows incoming requests and accepted friends.
- **Feed** shows all posts from you and your friends.
- Live updates flow over `/events`.

---

## Environment variables

### Node

| Variable | Default | Purpose |
|:---|:---|:---|
| `PW_NODE_ID` | random | label for logs |
| `PW_NAME` | = `PW_NODE_ID` | display name |
| `PW_DATA_DIR` | `data` | per-instance DB folder (relative to `node/`) |
| `PW_PASSPHRASE` | `test-passphrase` | unlocks the identity at rest |
| `PW_API_PORT` | `7701` | HTTP + WS API port for the Vue client |
| `PW_SERVERS` | `ws://localhost:7700` | comma-separated server URLs |
| `PW_SERVER` | — | legacy single-server variable |

### Server

| Variable | Default | Purpose |
|:---|:---|:---|
| `PORT` | `7700` | WebSocket port |
| `PW_SERVER_ID` | — | label (currently unused in logs) |

### Client

| Variable | Default | Purpose |
|:---|:---|:---|
| `VITE_NODE_URL` | `http://127.0.0.1:7701` | which local node to talk to |

---

## Data model

### Node database (`node/data/<id>/node.sqlite`)

- **identity** — encrypted private keys (AES-256-GCM, PBKDF2-derived key from passphrase).
- **friends** — `public_id`, `ecdh_public`, `name`, `shared_key`, `status`.
- **pending_nonces** — pending friend-request nonces with direction.
- **posts**, **likes**, **comments** — signed content, indexed by id and target.
- **profile** — local public profile (name, description, tags).

### Server memory (never persisted)

- **nodes** — `publicId → open WebSocket`.
- **blobs** — undelivered blobs by id, with 60-day TTL.
- **inbox** — `recipientId → [blobId]`.
- **profiles** — public signed profiles with 24-hour TTL.

---

## Wire protocol

Everything the node and server say to each other is in `shared/protocol.ts`.

### Client → Server

- `hello` — signed handshake: `{v, publicId, ecdhPublic, ts, nonce, sig}`
- `blob` — `{to, from, id, payload, ts}` — `payload` is base64 ciphertext or signed plaintext (handshake only)
- `blob_ack` — `{id}` — recipient confirms receipt, server may delete
- `profile_publish` — `{profile: {data, sig}}`
- `profile_search` — `{query, limit, requestId}`

### Server → Client

- `hello_ok`, `hello_err`
- `blob_deliver` — `{from, id, payload, ts}`
- `presence` — `{publicId}` — a peer came online
- `profile_search_result` — `{requestId, profiles}`
- `err`

### Inner envelope (after decryption of `blob.payload`)

```
{ kind: "friend_request" | "friend_accept" | "friend_decline"
      | "unfriend" | "post" | "like" | "comment",
  data: {...},
  sig: "<base64 ECDSA over canonical(data)>" }
```

Handshake messages before friendship is accepted are **signed plaintext**.
Everything after friendship is **signed + sealed** with the ECDH-derived shared key.

### Sealed envelope

```
{ v: 1, nonce: "<base64>", ciphertext: "<base64>" }
```

`ciphertext` = AES-256-GCM output with the auth tag appended.

---

## Security model

**What the server sees:**
- Which public keys are online.
- Which public key is sending a blob to which public key (routing metadata).
- Blob sizes and timestamps.
- Public, user-authored, self-signed profiles.

**What the server cannot see:**
- Any post, like, comment, or friend message body.
- The shared key between any two friends.
- The user's private signing or ECDH keys.
- The user's passphrase.

**What the user must protect:**
- The passphrase that unlocks their local identity.
- The `.sqlite` file in `data/<node>/` — it holds encrypted keys, but a strong passphrase is still required.
- Exported backups (they are encrypted with the passphrase, but still sensitive).

**What we don't protect against (yet):**
- Traffic analysis by a global adversary (metadata leaks remain).
- A malicious server colluding with one of your friends.
- Endpoint compromise of your machine.

---

## Feature status

Implemented:
- Identity (P-256, ECDSA + ECDH), passphrase-encrypted at rest
- Backup / restore of identity
- Multi-server relay client with reconnect + offline queue
- Friend handshake (request / accept / decline / unfriend)
- End-to-end encrypted posts, likes, comments
- Local feed, thread view, live updates via events
- Public signed profiles + server-side discovery
- Server-side blob TTL and deletion on ack

Not yet implemented (see roadmap below):
- Backfill / sync when two friends reconnect after a long offline period
- Group or friends-of-friends visibility
- Media attachments
- Multi-device identity
- Block list / unfriend UI
- Onion (garlic) routing across servers
- Erasure coding of blobs across servers

---

## Roadmap ideas

- **Sync-on-reconnect**: `sync_request { since }` / `sync_response { posts... }` between friends.
- **Groups**: key per group, rotate on membership change, posts sealed with the group key.
- **Media**: encrypted blobs stored on disk, referenced by hash in posts.
- **Multi-device**: same identity on two nodes; shared keys transferred via an encrypted bundle.
- **Onion layer**: wrap blob payloads in N layers of encryption, route through N servers,
  each unwrapping one layer. Server code is unchanged — only the node picks the path.
- **Erasure coding**: split a blob into K-of-N shards across servers. Tolerates losing
  some servers without losing data.

---

## Scripts reference

From the repo root:

| Command | What it does |
|:---|:---|
| `npm run server <name>` | start server with `instances/servers/<name>.env` |
| `npm run node <name>` | start node with `instances/nodes/<name>.env` |
| `npm run servers` | spawn all servers defined in `instances/servers/` |
| `npm run nodes` | spawn all nodes defined in `instances/nodes/` |

Each command prints the effective env at startup, so it's always clear which instance
you're looking at.

---

## License

Do whatever you want with it.
