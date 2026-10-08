import { defineStore } from "pinia";
import { ref } from "vue";
import { nodeApi, type Post } from "../api/node";

export const useFeedStore = defineStore("feed", () => {
  const posts = ref<Post[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      const r = await nodeApi.feed();
      posts.value = r.posts;
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }

  async function post(text: string) {
    await nodeApi.post(text);
    await load();
  }

  async function like(target: string) {
    await nodeApi.like(target);
    await load();
  }

  return { posts, loading, error, load, post, like };
});
