<script setup lang="ts">
import { onMounted, ref } from "vue";
import { nodeApi, type PublicProfile } from "../api/node";
import { useFriendsStore } from "../store/friends";

const friends = useFriendsStore();
const query = ref("");
const results = ref<PublicProfile[]>([]);
const loading = ref(false);
const searched = ref(false);
const sentTo = ref<string | null>(null);

onMounted(() => friends.load());

async function search() {
  loading.value = true;
  try {
    const r = await nodeApi.discover(query.value);
    results.value = r.profiles.map((p) => p.data);
    searched.value = true;
  } finally {
    loading.value = false;
  }
}

async function add(publicId: string) {
  await friends.request(publicId);
  sentTo.value = publicId;
  setTimeout(() => (sentTo.value = null), 2000);
}

function initials(id: string) {
  return id.slice(0, 2).toUpperCase();
}
function shortId(id: string) {
  return id.slice(0, 12) + "…";
}
</script>

<template>
  <div class="page">
    <h1 class="title">Discover</h1>
    <p class="muted" style="margin-top: 0">
      Search the public profiles of nodes connected to your servers.
    </p>

    <div class="row" style="margin-bottom: var(--space-5)">
      <input
        v-model="query"
        class="input"
        placeholder="Search name, bio, or tag"
        @keydown.enter="search"
      />
      <button class="btn btn-primary" :disabled="loading" @click="search">
        {{ loading ? "…" : "Search" }}
      </button>
    </div>

    <div v-if="searched && results.length === 0" class="empty">
      No profiles matched. Try a broader search, or ask a friend for their public ID.
    </div>

    <div class="stack">
      <div v-for="p in results" :key="p.publicId" class="card card-hover">
        <div class="row-between">
          <div class="row">
            <div class="avatar avatar-lg">{{ initials(p.publicId) }}</div>
            <div>
              <div style="font-weight: 600; font-size: 1.05em">
                {{ p.name || "(no name)" }}
              </div>
              <div class="mono faint">{{ shortId(p.publicId) }}</div>
            </div>
          </div>
          <button
            class="btn btn-primary"
            :disabled="sentTo === p.publicId"
            @click="add(p.publicId)"
          >
            {{ sentTo === p.publicId ? "Request sent" : "Add friend" }}
          </button>
        </div>
        <p v-if="p.description" class="muted" style="margin: var(--space-3) 0">
          {{ p.description }}
        </p>
        <div v-if="p.tags.length" class="row" style="gap: 6px; flex-wrap: wrap">
          <span v-for="t in p.tags" :key="t" class="tag">{{ t }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.title { font-size: 1.6em; margin: 0 0 var(--space-2); letter-spacing: -0.02em; }
.empty { text-align: center; color: var(--text-soft); padding: var(--space-6); }
</style>
