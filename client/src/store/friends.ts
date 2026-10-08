import { defineStore } from "pinia";
import { ref } from "vue";
import { nodeApi, type Friend } from "../api/node";

export const useFriendsStore = defineStore("friends", () => {
  const friends = ref<Friend[]>([]);
  const pendingIncoming = ref<Friend[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      const r = await nodeApi.friends();
      friends.value = r.friends;
      pendingIncoming.value = r.pendingIncoming;
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }

  async function request(to: string) {
    await nodeApi.request(to);
    await load();
  }

  async function accept(from: string) {
    await nodeApi.accept(from);
    await load();
  }

  async function decline(from: string) {
    await nodeApi.decline(from);
    await load();
  }

  return { friends, pendingIncoming, loading, error, load, request, accept, decline };
});
