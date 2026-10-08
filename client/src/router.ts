import { createRouter, createWebHistory } from "vue-router";
import Onboarding from "./views/Onboarding.vue";
import Feed from "./views/Feed.vue";
import Friends from "./views/Friends.vue";
import Compose from "./views/Compose.vue";
import Discover from "./views/Discover.vue";
import Profile from "./views/Profile.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: Feed },
    { path: "/onboarding", component: Onboarding },
    { path: "/friends", component: Friends },
    { path: "/compose", component: Compose },
    { path: "/discover", component: Discover },
    { path: "/profile", component: Profile },
  ],
});
