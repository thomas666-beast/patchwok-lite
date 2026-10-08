// Patchwork Lite — shared wire protocol

export const PROTOCOL_VERSION = 1;

// ---------- Handshake ----------

export interface HelloMsg {
  type: "hello";
  v: number;
  publicId: string;
  ecdhPublic: string;
  ts: number;
  nonce: string;
  sig: string;
}

export interface HelloOkMsg {
  type: "hello_ok";
  v: number;
  serverTime: number;
}

export interface HelloErrMsg {
  type: "hello_err";
  reason: string;
}

// ---------- Blobs ----------

export interface BlobMsg {
  type: "blob";
  to: string;
  from: string;
  id: string;
  payload: string;
  ts: number;
}

export interface BlobDeliverMsg {
  type: "blob_deliver";
  from: string;
  id: string;
  payload: string;
  ts: number;
}

export interface BlobAckMsg {
  type: "blob_ack";
  id: string;
}

export interface PresenceMsg {
  type: "presence";
  publicId: string;
}

export interface ErrMsg {
  type: "err";
  reason: string;
}

// ---------- Discovery ----------

export interface ProfileData {
  publicId: string;
  ecdhPublic: string;
  name: string;
  description: string;
  tags: string[];
  ts: number;
}

export interface SignedProfile {
  data: ProfileData;
  sig: string;
}

export interface ProfilePublishMsg {
  type: "profile_publish";
  profile: SignedProfile;
}

export interface ProfileSearchMsg {
  type: "profile_search";
  query: string;
  limit?: number;
  requestId: string;
}

export interface ProfileSearchResultMsg {
  type: "profile_search_result";
  requestId: string;
  profiles: SignedProfile[];
}

// ---------- Inner envelope ----------

export interface InnerEnvelope {
  kind:
    | "friend_request"
    | "friend_accept"
    | "friend_decline"
    | "unfriend"
    | "post"
    | "like"
    | "comment"
    | "sync_request"
    | "sync_response"
    | "attachment";
  data: Record<string, unknown>;
  sig: string;
}

// ---------- Handshake payloads ----------

export interface FriendRequestData {
  from: string;
  fromEcdh: string;
  name: string;
  nonce: string;
  ts: number;
}

export interface FriendAcceptData {
  from: string;
  fromEcdh: string;
  name: string;
  nonce: string;
  ts: number;
}

export interface FriendDeclineData {
  from: string;
  nonce: string;
  ts: number;
}

export interface UnfriendData {
  from: string;
  ts: number;
}

// ---------- Content payloads ----------

export interface AttachmentRef {
  hash: string;
  mime: string;
  name: string;
  size: number;
}

export interface PostData {
  author: string;
  text: string;
  ts: number;
  attachments?: AttachmentRef[];
}

export interface LikeData {
  author: string;
  target: string;
  ts: number;
}

export interface CommentData {
  author: string;
  target: string;
  text: string;
  ts: number;
}

export interface AttachmentData {
  author: string;
  hash: string;
  mime: string;
  name: string;
  size: number;
  payload: string;
  fileKey: string;
  nonce: string;
  ts: number;
}

// ---------- Sync ----------

export interface SyncRequestData {
  from: string;
  since: number;
  ts: number;
}

export interface SyncResponseData {
  from: string;
  since: number;
  items: SyncItem[];
  ts: number;
}

export interface SyncItem {
  kind: "post" | "like" | "comment";
  inner: InnerEnvelope;
}

// ---------- Unions ----------

export type ClientMsg =
  | HelloMsg
  | BlobMsg
  | BlobAckMsg
  | ProfilePublishMsg
  | ProfileSearchMsg;

export type ServerMsg =
  | HelloOkMsg
  | HelloErrMsg
  | BlobDeliverMsg
  | PresenceMsg
  | ProfileSearchResultMsg
  | ErrMsg;

// ---------- Canonical JSON ----------

export function canonical(obj: unknown): string {
  return JSON.stringify(sortKeys(obj));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
