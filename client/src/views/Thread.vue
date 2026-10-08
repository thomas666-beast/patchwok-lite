<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { nodeApi } from "../api/node";
import { useIdentityStore } from "../store/identity";
import AttachmentList from "../components/AttachmentList.vue";

const route = useRoute();
const identity = useIdentityStore();
const loading = ref(true);
const error = ref<string | null>(null);
const thread = ref<any>(null);
const commentText = ref("");

async function load() {
  loading.value = true;
  error.value = null;
  try {
    thread.value = await nodeApi.thread(String(route.params.id));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

async function submitComment() {
  if (!commentText.value.trim()) return;
  await nodeApi.comment(String(route.params.id), commentText.value.trim());
  commentText.value = "";
  await load();
}

async function like() {
  await nodeApi.like(String(route.params.id));
  await load();
}

onMounted(async () => {
  await identity.load();
  await load();
});

function initials(id: string) {
  return id.slice(0, 2).toUpperCase();
}
function shortId(id: string) {
  return id.slice(0, 10) + "…";
}
function isMine(author: string) {
  return identity.me?.publicId === author;
}
function relative(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(ts).toLocaleString();
}
</script>

<template>
  <div class="page">
    <RouterLink class="back" to="/">← Back to feed</RouterLink>

    <div v-if="loading" class="empty">Loading…</div>
    <div v-else-if="error" class="empty error">{{ error }}</div>

    <template v-else-if="thread">
      <article class="card post">
        <header class="row">
          <div class="avatar avatar-lg">
            {{ isMine(thread.post.author) ? "ME" : initials(thread.post.author) }}
          </div>
          <div>
            <div style="font-weight: 600">
              {{ isMine(thread.post.author) ? "you" : shortId(thread.post.author) }}
            </div>
            <div class="faint" style="font-size: 0.85em">
              {{ relative(thread.post.ts) }}
            </div>
          </div>
        </header>

        <p v-if="thread.post.text" class="body">{{ thread.post.text }}</p>

        <AttachmentList :attachments="thread.post.attachments || []" />

        <footer class="row" style="margin-top: var(--space-3)">
          <button class="btn" @click="like">♥ {{ thread.likes.length }}</button>
          <span class="metric">💬 {{ thread.comments.length }}</span>
        </footer>
      </article>

      <section style="margin-top: var(--space-5)">
        <h2 class="subtitle">Comments</h2>
        <div v-if="thread.comments.length === 0" class="muted" style="padding: var(--space-3) 0">
          No comments yet.
        </div>
        <div v-else class="stack">
          <div v-for="c in thread.comments" :key="c.id" class="card comment">
            <div class="row">
              <div class="avatar">{{ isMine(c.author) ? "ME" : initials(c.author) }}</div>
              <div style="flex: 1">
                <div class="row-between">
                  <span style="font-weight: 600; font-size: 0.9em">
                    {{ isMine(c.author) ? "you" : shortId(c.author) }}
                  </span>
                  <span class="faint" style="font-size: 0.8em">{{ relative(c.ts) }}</span>
                </div>
                <p style="margin: 4px 0 0">{{ c.text }}</p>
              </div>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top: var(--space-4)">
          <textarea
            v-model="commentText"
            class="textarea"
            rows="3"
            placeholder="Add a comment…"
          />
          <div class="row-between" style="margin-top: var(--space-3)">
            <span class="faint">{{ commentText.length }} / 2000</span>
            <button
              class="btn btn-primary"
              :disabled="!commentText.trim()"
              @click="submitComment"
            >
              Comment
            </button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.back { display: inline-block; margin-bottom: var(--space-4); color: var(--text-soft); }
.post { padding: var(--space-5); }
.post .body { margin: var(--space-4) 0; font-size: 1.1em; white-space: pre-wrap; }
.subtitle {
  font-size: 0.8em;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-soft);
  margin: 0 0 var(--space-3);
}
.metric {
  color: var(--text-soft);
  background: var(--bg-subtle);
  padding: 8px 14px;
  border-radius: 999px;
  font-size: 0.9em;
}
.empty { text-align: center; color: var(--text-soft); padding: var(--space-6); }
.empty.error { color: var(--danger); }
</style>
