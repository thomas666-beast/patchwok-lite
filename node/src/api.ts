// Patchwork Lite — local HTTP + WebSocket API for the Vue client

import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type Database from "better-sqlite3";
import type { Identity } from "./crypto/identity.ts";
import type { RelayClient } from "./relay/client.ts";
import {
  listFriends,
  listPendingIncoming,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  unfriend,
} from "./social/friends.ts";
import {
  createPost,
  createLike,
  createComment,
  listFeed,
  getPostWithThread,
} from "./social/content.ts";
import {
  sendAttachment,
  readAttachment,
} from "./social/attachments.ts";
import {
  getLocalProfile,
  setLocalProfile,
  exportBackup,
  importBackup,
} from "./crypto/keystore.ts";
import { buildProfile, publishProfile, searchProfiles } from "./social/profile.ts";
import { bus } from "./events.ts";

export interface ApiDeps {
  db: Database.Database;
  identity: Identity;
  relay: RelayClient;
  myName: string;
  nodeId: string;
  attachmentsDir: string;
}

export function startApi(port: number, deps: ApiDeps) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "200mb" }));

  const clients = new Set<WebSocket>();

  const broadcast = (event: { type: string; data: unknown }) => {
    const json = JSON.stringify(event);
    for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(json);
  };

  bus.on("event", (e) => broadcast(e));

  // ---------- identity ----------

  app.get("/whoami", (_req, res) => {
    res.json({
      nodeId: deps.nodeId,
      name: deps.myName,
      publicId: deps.identity.publicId,
      ecdhPublic: deps.identity.ecdhPublic,
    });
  });

  app.get("/backup", (_req, res) => {
    try {
      res.json({ backup: exportBackup(deps.db) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/restore", (req, res) => {
    try {
      const { backup } = req.body;
      if (!backup) return res.status(400).json({ error: "missing backup" });
      importBackup(deps.db, backup);
      res.json({ ok: true, note: "restart the node to load the restored identity" });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ---------- status ----------

  app.get("/status", (_req, res) => {
    res.json({ servers: deps.relay.serverStatus() });
  });

  // ---------- friends ----------

  app.get("/friends", (_req, res) => {
    res.json({
      friends: listFriends(deps.db),
      pendingIncoming: listPendingIncoming(deps.db),
    });
  });

  app.post("/friend/request", async (req, res) => {
    try {
      const { to } = req.body;
      if (!to) return res.status(400).json({ error: "missing 'to'" });
      await sendFriendRequest(deps.db, deps.identity, deps.relay, to, deps.myName);
      broadcast({ type: "friends_changed", data: {} });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/friend/accept", (req, res) => {
    try {
      acceptFriendRequest(deps.db, deps.identity, deps.relay, req.body.from, deps.myName);
      broadcast({ type: "friends_changed", data: {} });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/friend/decline", (req, res) => {
    try {
      declineFriendRequest(deps.db, deps.identity, deps.relay, req.body.from);
      broadcast({ type: "friends_changed", data: {} });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/friend/unfriend", (req, res) => {
    try {
      unfriend(deps.db, deps.identity, deps.relay, req.body.from);
      broadcast({ type: "friends_changed", data: {} });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ---------- feed ----------

  app.get("/feed", (_req, res) => {
    res.json({ posts: listFeed(deps.db) });
  });

  app.get("/thread/:postId", (req, res) => {
    const t = getPostWithThread(deps.db, req.params.postId);
    if (!t) return res.status(404).json({ error: "post not found" });
    res.json(t);
  });

  app.post("/post", (req, res) => {
    try {
      const { text, attachments } = req.body;
      if (!text?.trim() && (!attachments || attachments.length === 0)) {
        return res.status(400).json({ error: "missing text and attachments" });
      }
      const result = createPost(
        deps.db,
        deps.identity,
        deps.relay,
        text ?? "",
        attachments,
      );
      broadcast({ type: "feed_changed", data: {} });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/like", (req, res) => {
    try {
      const result = createLike(deps.db, deps.identity, deps.relay, req.body.target);
      broadcast({ type: "feed_changed", data: {} });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/comment", (req, res) => {
    try {
      const { target, text } = req.body;
      if (!target || !text) return res.status(400).json({ error: "missing fields" });
      const result = createComment(deps.db, deps.identity, deps.relay, target, text);
      broadcast({ type: "feed_changed", data: {} });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ---------- attachments ----------

  app.post("/upload", (req, res) => {
    try {
      const { filename, mime, dataBase64 } = req.body;
      if (!filename || !mime || !dataBase64) {
        return res.status(400).json({ error: "missing filename, mime, or dataBase64" });
      }
      const bytes = Buffer.from(dataBase64, "base64");
      const ref = sendAttachment(deps.db, deps.identity, deps.relay, {
        attachmentsDir: deps.attachmentsDir,
        filename,
        mime,
        bytes,
      });
      if (!ref) return res.status(400).json({ error: "no friends to send to" });
      res.json(ref);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/attachment/:hash", (req, res) => {
    try {
      const att = readAttachment(deps.db, req.params.hash);
      if (!att) return res.status(404).json({ error: "not found" });
      res.setHeader("Content-Type", att.mime);
      res.setHeader("Content-Disposition", `inline; filename="${att.name}"`);
      res.send(att.bytes);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ---------- profile & discovery ----------

  app.get("/profile", (_req, res) => {
    res.json(getLocalProfile(deps.db) ?? { name: deps.myName, description: "", tags: [] });
  });

  app.post("/profile", (req, res) => {
    try {
      const { name, description, tags } = req.body;
      setLocalProfile(deps.db, {
        name: name ?? deps.myName,
        description: description ?? "",
        tags: Array.isArray(tags) ? tags : [],
      });
      const saved = getLocalProfile(deps.db)!;
      const sp = buildProfile(deps.identity, saved);
      publishProfile(deps.relay, sp);
      res.json({ ok: true, profile: sp.data });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/discover", async (req, res) => {
    try {
      const q = String(req.query.q ?? "");
      const results = await searchProfiles(deps.relay, q, 50);
      const me = deps.identity.publicId;
      res.json({ profiles: results.filter((r) => r.data.publicId !== me) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ---------- HTTP server + WS events ----------

  const server: Server = app.listen(port, "127.0.0.1", () => {
    console.log(`[api] listening on http://127.0.0.1:${port}`);
  });

  const wss = new WebSocketServer({ server, path: "/events" });
  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
  });

  return {
    close: () => {
      for (const ws of clients) ws.close();
      wss.close();
      server.close();
    },
  };
}
