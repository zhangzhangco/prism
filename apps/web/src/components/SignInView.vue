<script setup lang="ts">
import { ref } from "vue";
import { useSessionStore } from "@/stores";

const session = useSessionStore();
const mode = ref<"signin" | "signup">("signin");
const email = ref("");
const password = ref("");
const displayName = ref("");

async function submit(): Promise<void> {
  if (mode.value === "signin") {
    await session.signIn(email.value, password.value);
  } else {
    await session.signUp(email.value, password.value, displayName.value || undefined);
  }
}
</script>

<template>
  <div class="auth">
    <h1>Prism</h1>
    <p>A node canvas for AI media generation.</p>

    <form @submit.prevent="submit">
      <label class="auth__field">
        <span>Email</span>
        <input v-model="email" type="email" autocomplete="email" required placeholder="you@example.com" />
      </label>

      <label v-if="mode === 'signup'" class="auth__field">
        <span>Display name</span>
        <input v-model="displayName" type="text" autocomplete="name" placeholder="Optional" />
      </label>

      <label class="auth__field">
        <span>Password</span>
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
          minlength="8"
          placeholder="At least 8 characters"
        />
      </label>

      <p v-if="session.error" class="auth__error">{{ session.error }}</p>

      <button class="primary" type="submit" :disabled="session.busy" style="width: 100%">
        {{ session.busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account" }}
      </button>
    </form>

    <div class="auth__switch">
      <span>{{ mode === "signin" ? "No account yet?" : "Already registered?" }}</span>
      <button
        class="ghost"
        type="button"
        @click="mode = mode === 'signin' ? 'signup' : 'signin'"
      >
        {{ mode === "signin" ? "Create one" : "Sign in" }}
      </button>
    </div>
  </div>
</template>
