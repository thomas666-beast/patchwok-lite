<script setup lang="ts">
import { onMounted } from "vue";
import { useFeedStore } from "../store/feed";
import { useIdentityStore } from "../store/identity";
import AttachmentList from "../components/AttachmentList.vue";

const feed = useFeedStore();
const identity = useIdentityStore();

onMounted(async () => {
  await identity.load();
  await feed.load();
});

function initials(id: string) {
  return id.slice(0, 2).toUpperCase();
}
function shortId(id: string) {
  return id.slice(0, 8) + "…";
}
function isMine(author: string) {
  return identity.me?.publicId === author;
}
function relative(ts: number) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString();
}
</script>

<template>
  <div class="page">
    <div class="row-between" style="margin-bottom: var(--space-5)">
      <h1 class="title">Feed</h1>
      <RouterLink class="btn btn-primary" to="/compose">New post</RouterLink>
    </div>

    <div v-if="feed.loading" class="empty">Loading…</div>
    <div v-else-if="feed.error" class="empty error">Node unreachable: {{ feed.error }}</div>

    <div v-else-if="feed.posts.length === 0" class="empty">
      <div class="empty-icon">◌</div>
      <p>No posts yet.</p>
      <RouterLink class="btn btn-primary" to="/compose">Write the first one</RouterLink>
    </div>

    <div v-else class="stack">
      <RouterLink
        v-for="p in feed.posts"
        :key="p.id"
        :to="`/post/${p.id}`"
        class="post-link"
      >
        <article class="card card-hover post">
          <header class="row-between">
            <div class="row">
              <div class="avatar">{{ isMine(p.author) ? "ME" : initials(p.author) }}</div>
              <div>
                <div class="author">
                  {{ isMine(p.author) ? "you" : shortId(p.author) }}
                </div>
                <div class="faint" style="font-size: 0.8em">{{ relative(p.ts) }}</div>
              </div>
            </div>
          </header>

          <p v-if="p.text" class="body">{{ p.text }}</p>

          <AttachmentList :attachments="p.attachments || []" />

          <footer class="row" style="margin-top: var(--space-3)">
            <span class="metric">♥ {{ p.likes }}</span>
            <span class="metric">💬 {{ p.comments }}</span>
          </footer>
        </article>
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.title { font-size: 1.6em; margin: 0; letter-spacing: -0.02em; }

.post-link { display: block; color: inherit; text-decoration: none; }
.post-link:hover { text-decoration: none; }

.post { display: block; }
.post .author { font-weight: 600; font-size: 0.95em; }
.post .body { margin: var(--space-3) 0 var(--space-3); white-space: pre-wrap; word-wrap: break-word; }

.metric {
  font-size: 0.85em;
  color: var(--text-soft);
  background: var(--bg-subtle);
  padding: 4px 10px;
  border-radius: 999px;
}

.empty {
  text-align: center;
  padding: var(--space-7) var(--space-4);
  color: var(--text-soft);
}
.empty.error { color: var(--danger); }
.empty-icon {
  font-size: 48px;
  color: var(--text-faint);
  margin-bottom: var(--space-3);
}
</style>
