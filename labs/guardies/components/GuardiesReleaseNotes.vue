<script setup>
import { GUARDIES_RELEASES, GUARDIES_VERSION } from '../version.js';
</script>

<template>
  <details class="admin-panel release-notes-panel no-print">
    <summary>
      <span class="admin-summary-title">
        <span class="admin-icon" aria-hidden="true">i</span>
        <strong>Novetats de Guàrdies</strong>
      </span>
      <span class="cache-info">v{{ GUARDIES_VERSION }}</span>
    </summary>
    <div class="release-notes-body">
      <article v-for="release in GUARDIES_RELEASES" :key="release.version" class="release-note">
        <header>
          <strong>Versió {{ release.version }}</strong>
          <time>Publicada el {{ release.date }}</time>
        </header>
        <ul>
          <li v-for="change in release.changes" :key="change">{{ change }}</li>
        </ul>
      </article>
    </div>
  </details>
</template>
