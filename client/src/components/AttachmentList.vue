<script setup lang="ts">
import { nodeApi, type AttachmentRef } from "../api/node";

const props = defineProps<{ attachments: AttachmentRef[] }>();

function url(hash: string) {
  return nodeApi.attachmentUrl(hash);
}
function isImage(mime: string) {
  return mime.startsWith("image/");
}
function isVideo(mime: string) {
  return mime.startsWith("video/");
}
</script>

<template>
  <div v-if="props.attachments.length" class="attachments">
    <div v-for="a in props.attachments" :key="a.hash" class="attachment">
      <img v-if="isImage(a.mime)" :src="url(a.hash)" :alt="a.name" />

      <video
        v-else-if="isVideo(a.mime)"
        :src="url(a.hash)"
        controls
        preload="metadata"
        playsinline
      ></video>

      <a v-else :href="url(a.hash)" target="_blank" class="file">
        📎 {{ a.name }}
      </a>
    </div>
  </div>
</template>

<style scoped>
.attachments {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-2);
  margin-top: var(--space-3);
}
.attachment img,
.attachment video {
  width: 100%;
  border-radius: var(--radius-sm);
  display: block;
  max-height: 400px;
  object-fit: cover;
  background: #000;
}
.file {
  display: inline-block;
  padding: var(--space-2) var(--space-3);
  background: var(--bg-subtle);
  border-radius: var(--radius-sm);
  font-size: 0.9em;
}
</style>
