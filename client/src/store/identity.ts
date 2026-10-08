import { defineStore } from "pinia";
import { ref } from "vue";
import { nodeApi, type WhoAmI } from "../api/node";

export const useIdentityStore = defineStore("identity", () => {
  const me = ref<WhoAmI | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load() {
    loading.value = true;
    error.value = null;
    try {
      me.value = await nodeApi.whoami();
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }

  return { me, loading, error, load };
});
