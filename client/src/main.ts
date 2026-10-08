import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { openEventStream } from "./api/node";
import { useFeedStore } from "./store/feed";
import { useFriendsStore } from "./store/friends";
import "./styles/theme.css"; // ← add this

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");

const feed = useFeedStore();
const friends = useFriendsStore();

let feedTimer: number | null = null;
let friendsTimer: number | null = null;

openEventStream((event) => {
  if (event.type === "feed_changed") {
    if (feedTimer) window.clearTimeout(feedTimer);
    feedTimer = window.setTimeout(() => feed.load(), 200);
  }
  if (event.type === "friends_changed") {
    if (friendsTimer) window.clearTimeout(friendsTimer);
    friendsTimer = window.setTimeout(() => friends.load(), 200);
  }
});
