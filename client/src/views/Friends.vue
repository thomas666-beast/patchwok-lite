<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useFriendsStore } from "../store/friends";

const friends = useFriendsStore();
const newFriendId = ref("");

onMounted(() => friends.load());

async function add() {
  if (!newFriendId.value.trim()) return;
  await friends.request(newFriendId.value.trim());
  newFriendId.value = "";
}

function initials(id: string) {
  return id.slice(0, 2).toUpperCase();
}
function shortId(id: string) {
  return id.slice(0, 10) + "…";
}
</script>

<template>
  <div class="page">
    <h1 class="title">Friends</h1>

    <div v-if="friends.error" class="error-box">{{ friends.error }}</div>

    <div class="card" style="margin-bottom: var(--space-5)">
      <h2 class="subtitle">Add a friend</h2>
      <p class="muted" style="margin-top: 0">
        Paste their public ID (they can copy it from their Identity page).
      </p>
      <div class="row">
        <input
          v-model="newFriendId"
          class="input"
          placeholder="Public ID"
        />
        <button class="btn btn-primary" :disabled="!newFriendId.trim()" @click="add">
          Send
        </button>
      </div>
    </div>

    <section v-if="friends.pendingIncoming.length" style="margin-bottom: var(--space-5)">
      <h2 class="subtitle">Incoming requests</h2>
      <div class="stack">
        <div v-for="f in friends.pendingIncoming" :key="f.public_id" class="card row-between">
          <div class="row">
            <div class="avatar">{{ initials(f.public_id) }}</div>
            <div>
              <div style="font-weight: 600">{{ f.name }}</div>
              <div class="mono faint">{{ shortId(f.public_id) }}</div>
            </div>
          </div>
          <div class="row">
            <button class="btn btn-ghost btn-danger" @click="friends.decline(f.public_id)">
              Decline
            </button>
            <button class="btn btn-primary" @click="friends.accept(f.public_id)">
              Accept
            </button>
          </div>
        </div>
      </div>
    </section>

    <section>
      <h2 class="subtitle">Your friends</h2>
      <div v-if="friends.friends.length === 0" class="empty">
        No friends yet. Find someone on <RouterLink to="/discover">Discover</RouterLink>.
      </div>
      <div v-else class="stack">
        <div v-for="f in friends.friends" :key="f.public_id" class="card row-between">
          <div class="row">
            <div class="avatar">{{ initials(f.public_id) }}</div>
            <div>
              <div style="font-weight: 600">{{ f.name }}</div>
              <div class="mono faint">{{ shortId(f.public_id) }}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.title { font-size: 1.6em; margin: 0 0 var(--space-5); letter-spacing: -0.02em; }
.subtitle { font-size: 1em; margin: 0 0 var(--space-3); color: var(--text-soft); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; font-size: 0.8em; }
.error-box { background: var(--danger-soft); color: var(--danger); padding: var(--space-3) var(--space-4); border-radius: var(--radius-sm); margin-bottom: var(--space-4); }
.empty { text-align: center; color: var(--text-soft); padding: var(--space-6); }
</style>
