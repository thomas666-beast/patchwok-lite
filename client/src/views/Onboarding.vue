<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useIdentityStore } from "../store/identity";
import { nodeApi } from "../api/node";

const identity = useIdentityStore();
const copied = ref(false);
const backupText = ref("");
const importText = ref("");
const importResult = ref<string | null>(null);

onMounted(() => identity.load());

function copyId() {
  if (!identity.me) return;
  navigator.clipboard.writeText(identity.me.publicId);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}

async function exportBackup() {
  const { backup } = await nodeApi.backup();
  backupText.value = backup;
  const blob = new Blob([backup], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `patchwork-backup-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importBackup() {
  if (!importText.value.trim()) return;
  try {
    await nodeApi.restore(importText.value.trim());
    importResult.value = "Restored. Restart the node, then reload this page.";
  } catch (e) {
    importResult.value = "Error: " + (e as Error).message;
  }
}
</script>

<template>
  <div class="page">
    <h1 class="title">Identity</h1>

    <div v-if="identity.loading" class="empty">Loading…</div>
    <div v-else-if="identity.error" class="card error-card">
      Cannot reach local node: {{ identity.error }}
    </div>

    <template v-else-if="identity.me">
      <div class="card" style="margin-bottom: var(--space-5)">
        <div class="row" style="margin-bottom: var(--space-3)">
          <div class="avatar avatar-lg">ID</div>
          <div>
            <div style="font-weight: 600; font-size: 1.05em">{{ identity.me.name }}</div>
            <div class="faint">Your node: {{ identity.me.nodeId }}</div>
          </div>
        </div>

        <label class="field">
          <span>Your public ID <span class="faint">— share this to receive requests</span></span>
          <textarea readonly class="textarea mono" rows="3">{{ identity.me.publicId }}</textarea>
        </label>

        <button class="btn" @click="copyId">
          {{ copied ? "Copied" : "Copy public ID" }}
        </button>
      </div>

      <div class="card" style="margin-bottom: var(--space-5)">
        <h2 class="subtitle">Backup</h2>
        <p class="muted" style="margin-top: 0">
          The backup is encrypted with your passphrase.
          Without it, the backup is useless. Store it somewhere safe.
        </p>
        <button class="btn btn-primary" @click="exportBackup">Export backup</button>
        <textarea
          v-if="backupText"
          readonly
          class="textarea mono"
          rows="4"
          style="margin-top: var(--space-3)"
        >{{ backupText }}</textarea>
      </div>

      <div class="card">
        <h2 class="subtitle">Restore</h2>
        <p class="muted" style="margin-top: 0">
          Paste a backup here to replace this node's identity.
          Restart the node afterwards, using the passphrase that was set
          when the backup was made.
        </p>
        <textarea
          v-model="importText"
          class="textarea mono"
          rows="4"
          placeholder="Paste backup here"
        />
        <button
          class="btn btn-primary"
          style="margin-top: var(--space-3)"
          :disabled="!importText.trim()"
          @click="importBackup"
        >
          Restore
        </button>
        <p v-if="importResult" class="muted" style="margin-top: var(--space-3)">
          {{ importResult }}
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.title { font-size: 1.6em; margin: 0 0 var(--space-5); letter-spacing: -0.02em; }
.subtitle { font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-soft); margin: 0 0 var(--space-3); font-weight: 600; }
.field { display: block; margin-bottom: var(--space-4); }
.field > span { display: block; font-size: 0.85em; font-weight: 500; color: var(--text-soft); margin-bottom: 6px; }
.error-card { background: var(--danger-soft); color: var(--danger); }
.empty { text-align: center; color: var(--text-soft); padding: var(--space-6); }
</style>
