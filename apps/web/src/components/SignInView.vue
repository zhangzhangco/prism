<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useSessionStore } from "@/stores";

const { t } = useI18n();
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
    <h1>{{ t("auth.title") }}</h1>
    <p>{{ t("auth.subtitle") }}</p>

    <form @submit.prevent="submit">
      <label class="auth__field">
        <span>{{ t("auth.email") }}</span>
        <input v-model="email" type="email" autocomplete="email" required placeholder="you@example.com" />
      </label>

      <label v-if="mode === 'signup'" class="auth__field">
        <span>{{ t("auth.displayName") }}</span>
        <input v-model="displayName" type="text" autocomplete="name" />
      </label>

      <label class="auth__field">
        <span>{{ t("auth.password") }}</span>
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
          minlength="8"
          :placeholder="t('auth.passwordHint')"
        />
      </label>

      <p v-if="session.error" class="auth__error">{{ session.error }}</p>

      <button class="primary" type="submit" :disabled="session.busy" style="width: 100%">
        {{ session.busy ? t("common.loading") : mode === "signin" ? t("auth.signIn") : t("auth.signUp") }}
      </button>
    </form>

    <div class="auth__switch">
      <span>{{ mode === "signin" ? t("auth.noAccount") : t("auth.haveAccount") }}</span>
      <button class="ghost" type="button" @click="mode = mode === 'signin' ? 'signup' : 'signin'">
        {{ mode === "signin" ? t("auth.createOne") : t("auth.signInInstead") }}
      </button>
    </div>
  </div>
</template>
