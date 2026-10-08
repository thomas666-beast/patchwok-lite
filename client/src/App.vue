<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { useRoute } from "vue-router";
import { nodeApi } from "./api/node";
import { useIdentityStore } from "./store/identity";

const identity = useIdentityStore();
const route = useRoute();
const servers = ref<Array<{ url: string; connected: boolean }>>([]);

async function pollStatus() {
  try {
    const r = await nodeApi.status();
    servers.value = r.servers;
  } catch {
    servers.value = [];
  }
}

const anyServerUp = computed(() => servers.value.some((s) => s.connected));

onMounted(async () => {
  await identity.load();
  await pollStatus();
  setInterval(async () => {
    if (identity.error) await identity.load();
    await pollStatus();
  }, 5000);
});
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="logo">◈</div>
        <span>Patchwork</span>
      </div>

      <nav class="nav">
        <RouterLink to="/" :class="{ active: route.path === '/' }">Feed</RouterLink>
        <RouterLink to="/compose" :class="{ active: route.path === '/compose' }">Compose</RouterLink>
        <RouterLink to="/friends" :class="{ active: route.path === '/friends' }">Friends</RouterLink>
        <RouterLink to="/discover" :class="{ active: route.path === '/discover' }">Discover</RouterLink>
        <RouterLink to="/profile" :class="{ active: route.path === '/profile' }">Profile</RouterLink>
        <RouterLink to="/onboarding" :class="{ active: route.path === '/onboarding' }">Identity</RouterLink>
      </nav>

      <div class="status" :title="anyServerUp ? 'Connected' : 'No server connection'">
        <span
          v-for="s in servers"
          :key="s.url"
          :class="['dot', s.connected ? 'up' : 'down']"
        />
        <span v-if="servers.length === 0" class="dot down" />
      </div>
    </header>

    <div v-if="identity.error" class="banner">
      ⚠ Local node unreachable.
      <button class="btn btn-ghost" @click="identity.load()">Retry</button>
    </div>

    <main>
      <RouterView />
    </main>

    <footer class="footer faint">
      Your node is the source of truth. Servers only see ciphertext.
    </footer>
  </div>
</template>

<style scoped>
.shell { min-height: 100vh; display: flex; flex-direction: column; }

.topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: 0 var(--space-5);
  height: 60px;
  background: color-mix(in oklab, var(--bg) 80%, transparent);
  backdrop-filter: saturate(180%) blur(14px);
  border-bottom: 1px solid var(--border);
}

.brand { display: flex; align-items: center; gap: var(--space-2); font-weight: 700; letter-spacing: -0.01em; }
.logo {
  width: 28px; height: 28px; border-radius: 8px;
  background: var(--accent); color: white;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 16px;
}

.nav { display: flex; gap: var(--space-2); flex: 1; }
.nav a {
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  color: var(--text-soft);
  font-weight: 500;
}
.nav a:hover { background: var(--bg-subtle); color: var(--text); text-decoration: none; }
.nav a.active { background: var(--accent-soft); color: var(--accent-strong); }

.status { display: flex; gap: 6px; align-items: center; }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.dot.up { background: var(--success); box-shadow: 0 0 0 3px color-mix(in oklab, var(--success) 25%, transparent); }
.dot.down { background: var(--text-faint); }

.banner {
  background: var(--danger-soft);
  color: var(--danger);
  padding: 10px var(--space-5);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

main { flex: 1; }

.footer {
  padding: var(--space-5);
  text-align: center;
  font-size: 0.85em;
  border-top: 1px solid var(--border);
}

@media (max-width: 640px) {
  .topbar { flex-wrap: wrap; height: auto; padding: var(--space-3) var(--space-4); gap: var(--space-3); }
  .nav { order: 3; width: 100%; overflow-x: auto; }
  .nav a { white-space: nowrap; }
}
</style>
