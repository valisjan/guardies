<template>
  <details id="convivencia-panel" class="admin-panel convivencia-panel no-print">
    <summary>
      <span class="admin-summary-title">
        <span class="admin-icon" aria-hidden="true">◷</span>
        <strong>Configuració de guàrdies de convivència</strong>
      </span>
      <span class="cache-info">Planificació setmanal</span>
    </summary>
    <div class="admin-body admin-body-single">
      <section class="admin-block convivencia-admin">
        <div class="admin-block-head">
          <div>
            <p class="kicker">Convivència</p>
            <h2>Assignació per dia i sessió</h2>
          </div>
          <button id="clear-convivencia" type="button" class="ghost">Neteja setmana</button>
        </div>
        <div id="convivencia-admin-list" class="convivencia-admin-list"></div>
      </section>
    </div>
  </details>
</template>
