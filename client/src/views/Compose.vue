<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { nodeApi, type AttachmentRef } from "../api/node";
import { useFeedStore } from "../store/feed";
import { bytesToBase64 } from "../api/base64";

const feed = useFeedStore();
const router = useRouter();
const text = ref("");
const sending = ref(false);
const error = ref<string | null>(null);
const attachments = ref<AttachmentRef[]>([]);
const uploading = ref(false);

const ALLOWED = /^(image|video)\//;

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files) return;
  uploading.value = true;
  error.value = null;
  try {
    for (const file of Array.from(input.files)) {
      const mime = file.type || "";
      if (!ALLOWED.test(mime)) {
        error.value = `Only images and videos are allowed (skipped ${file.name})`;
        continue;
      }
      const buf = await file.arrayBuffer();
      const dataBase64 = bytesToBase64(new Uint8Array(buf));
      const ref = await nodeApi.upload(file.name, mime, dataBase64);
      attachments.value.push(ref);
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    uploading.value = false;
    input.value = "";
  }
}

function removeAttachment(hash: string) {
  attachments.value = attachments.value.filter((a) => a.hash !== hash);
}

async function submit() {
  if (!text.value.trim() && attachments.value.length === 0) return;
  sending.value = true;
  error.value = null;
  try {
    if (attachments.value.length) {
      await nodeApi.postWith(text.value.trim(), attachments.value);
    } else {
      await feed.post(text.value.trim());
    }
    text.value = "";
    attachments.value = [];
    router.push("/");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <div class="page">
    <h1 class="title">New post</h1>
    <p class="muted" style="margin-top: 0">
      Only your accepted friends will see this. End-to-end encrypted.
    </p>

    <div class="card">
      <textarea
        v-model="text"
        class="textarea"
        rows="6"
        placeholder="What's on your mind?"
        maxlength="2000"
      />

      <div class="row" style="margin-top: var(--space-3)">
        <label class="btn btn-ghost">
          📎 Attach image or video
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            @change="onFiles"
          />
        </label>
        <span v-if="uploading" class="faint">Uploading…</span>
      </div>

      <div
        v-if="attachments.length"
        class="row"
        style="flex-wrap: wrap; margin-top: var(--space-2)"
      >
        <div v-for="a in attachments" :key="a.hash" class="chip">
          <span class="chip-kind">{{ a.mime.startsWith("video/") ? "🎬" : "🖼" }}</span>
          <span class="chip-name">{{ a.name }}</span>
          <button class="btn btn-ghost" @click="removeAttachment(a.hash)">✕</button>
        </div>
      </div>

      <div class="row-between" style="margin-top: var(--space-3)">
        <span class="faint">{{ text.length }} / 2000</span>
        <div class="row">
          <RouterLink class="btn btn-ghost" to="/">Cancel</RouterLink>
          <button
            class="btn btn-primary"
            :disabled="sending || (!text.trim() && attachments.length === 0)"
            @click="submit"
          >
            {{ sending ? "Sending…" : "Post" }}
          </button>
        </div>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
    </div>
  </div>
</template>

<style scoped>
.title { font-size: 1.6em; margin: 0 0 var(--space-2); letter-spacing: -0.02em; }
.error { color: var(--danger); margin: var(--space-3) 0 0; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--bg-subtle);
  border-radius: 999px;
  font-size: 0.85em;
  max-width: 240px;
}
.chip-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
