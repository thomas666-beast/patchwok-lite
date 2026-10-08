<script setup lang="ts">
import { onMounted, ref } from "vue";
import { nodeApi } from "../api/node";

const name = ref("");
const description = ref("");
const tagsText = ref("");
const saving = ref(false);
const saved = ref(false);

onMounted(async () => {
  const p = await nodeApi.profile();
  name.value = p.name;
  description.value = p.description;
  tagsText.value = p.tags.join(", ");
});

async function save() {
  saving.value = true;
  try {
    await nodeApi.saveProfile({
      name: name.value,
      description: description.value,
      tags: tagsText.value.split(",").map((t) => t.trim()).filter(Boolean),
    });
    saved.value = true;
    setTimeout(() => (saved.value = false), 1500);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="page">
    <h1 class="title">Public profile</h1>
    <p class="muted" style="margin-top: 0">
      Published to your servers so other nodes can discover you.
      It is signed by your key, so no one can forge it. It is <strong>public</strong>.
    </p>

    <div class="card">
      <label class="field">
        <span>Display name</span>
        <input v-model="name" class="input" placeholder="Alice" />
      </label>

      <label class="field">
        <span>Description</span>
        <textarea
          v-model="description"
          class="textarea"
          rows="3"
          placeholder="A sentence about you."
        />
      </label>

      <label class="field">
        <span>Tags <span class="faint">(comma separated)</span></span>
        <input v-model="tagsText" class="input" placeholder="p2p, vue, coffee" />
      </label>

      <div class="row-between" style="margin-top: var(--space-4)">
        <span class="faint" v-if="saved">Saved &amp; published</span>
        <span v-else></span>
        <button class="btn btn-primary" :disabled="saving" @click="save">
          {{ saving ? "Saving…" : "Save & publish" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.title { font-size: 1.6em; margin: 0 0 var(--space-2); letter-spacing: -0.02em; }
.field { display: block; margin-bottom: var(--space-4); }
.field > span { display: block; font-size: 0.85em; font-weight: 500; color: var(--text-soft); margin-bottom: 6px; }
</style>
