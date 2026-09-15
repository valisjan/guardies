<script setup>
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { guardCountForSlot, guardSlotKey, normalizeGuardCount } from '../../../src/modules/guardies/domain/workflow.js';
import { useGuardiesStore } from '../stores/guardies.js';

const store = useGuardiesStore();
const { guardCounts, professorOptions, courseName, sessions, guardiaCodes } = storeToRefs(store);

const dayLabels = { 1: 'Dilluns', 2: 'Dimarts', 3: 'Dimecres', 4: 'Dijous', 5: 'Divendres' };

const teacherRows = computed(() => professorOptions.value.map((teacher) => {
  const count = normalizeGuardCount(guardCounts.value.get(teacher.placa));
  return {
    teacherId: teacher.placa,
    label: teacher.label,
    guard: count.guard,
    released: count.released,
    total: count.guard,
  };
}));

const totals = computed(() => teacherRows.value.reduce((result, teacher) => ({
  guard: result.guard + teacher.guard,
  released: result.released + teacher.released,
  total: result.total + teacher.total,
}), { guard: 0, released: 0, total: 0 }));

function sortTeachers(direction) {
  return [...teacherRows.value].sort((a, b) => (
    direction * (a.total - b.total)
    || a.label.localeCompare(b.label, 'ca', { numeric: true })
  )).slice(0, 5);
}

const mostActiveTeachers = computed(() => sortTeachers(-1));
const leastActiveTeachers = computed(() => sortTeachers(1));

const slotRows = computed(() => {
  const hours = Array.from(new Set(sessions.value
    .map((session) => session.hora)
    .filter((hour) => hour && hour !== 'PATI')))
    .sort((a, b) => String(a).localeCompare(String(b), 'ca', { numeric: true }));
  const hourNumber = new Map(hours.map((hour, index) => [hour, index + 1]));
  const slots = new Map();

  sessions.value.filter((session) => (
    session.dia >= '1' && session.dia <= '5'
    && session.hora !== 'PATI'
    && (session.activitatEsGuardiaGeneral || guardiaCodes.value.has(session.activitat))
  )).forEach((session) => {
    const key = guardSlotKey(session.dia, session.hora);
    if (!slots.has(key)) slots.set(key, {
      key,
      day: session.dia,
      hour: session.hora,
      label: `${dayLabels[session.dia]} · ${hourNumber.get(session.hora)}a · ${session.hora}`,
    });
  });

  return Array.from(slots.values(), (slot) => ({
    ...slot,
    total: teacherRows.value.reduce((sum, teacher) => (
      sum + guardCountForSlot(guardCounts.value.get(teacher.teacherId), slot.key)
    ), 0),
  }));
});

function sortSlots(direction) {
  return [...slotRows.value].sort((a, b) => (
    direction * (a.total - b.total)
    || Number(a.day) - Number(b.day)
    || String(a.hour).localeCompare(String(b.hour), 'ca', { numeric: true })
  )).slice(0, 5);
}

const busiestSlots = computed(() => sortSlots(-1));
const quietestSlots = computed(() => sortSlots(1));
</script>

<template>
  <section id="guardies-statistics-panel" class="guard-statistics-panel no-print" aria-labelledby="guard-statistics-title">
    <header class="guard-statistics-head">
      <div>
        <p class="kicker">Curs {{ courseName }}</p>
        <h2 id="guard-statistics-title">Estadístiques de guàrdies</h2>
      </div>
    </header>

    <div class="guard-statistics-totals">
      <article>
        <span>Guàrdies G totals</span>
        <strong data-stat-total>{{ totals.total }}</strong>
      </article>
      <article>
        <span>Amb G</span>
        <strong data-stat-guard>{{ totals.guard }}</strong>
      </article>
      <article>
        <span>Com a alliberat</span>
        <strong data-stat-released>{{ totals.released }}</strong>
      </article>
    </div>

    <div class="guard-statistics-grid">
      <section class="guard-ranking-card" aria-labelledby="most-teachers-title">
        <header><h3 id="most-teachers-title">Més guàrdies</h3><span>Top 5</span></header>
        <ol data-ranking-most>
          <li v-for="(teacher, index) in mostActiveTeachers" :key="teacher.teacherId">
            <b>{{ index + 1 }}</b>
            <strong>{{ teacher.label }}</strong>
            <span class="guard-ranking-breakdown"><em>{{ teacher.guard }} G</em><em>{{ teacher.released }} allib.</em></span>
            <mark>{{ teacher.guard }}</mark>
          </li>
        </ol>
      </section>

      <section class="guard-ranking-card" aria-labelledby="least-teachers-title">
        <header><h3 id="least-teachers-title">Menys guàrdies</h3><span>Top 5</span></header>
        <ol data-ranking-least>
          <li v-for="(teacher, index) in leastActiveTeachers" :key="teacher.teacherId">
            <b>{{ index + 1 }}</b>
            <strong>{{ teacher.label }}</strong>
            <span class="guard-ranking-breakdown"><em>{{ teacher.guard }} G</em><em>{{ teacher.released }} allib.</em></span>
            <mark>{{ teacher.guard }}</mark>
          </li>
        </ol>
      </section>

      <section class="guard-ranking-card guard-slot-ranking" aria-labelledby="busiest-slots-title">
        <header><h3 id="busiest-slots-title">Franges amb més G</h3><span>Top 5</span></header>
        <ol data-slot-most>
          <li v-for="(slot, index) in busiestSlots" :key="slot.key">
            <b>{{ index + 1 }}</b>
            <strong>{{ slot.label }}</strong>
            <mark>{{ slot.total }}</mark>
          </li>
        </ol>
      </section>

      <section class="guard-ranking-card guard-slot-ranking" aria-labelledby="quietest-slots-title">
        <header><h3 id="quietest-slots-title">Franges amb menys G</h3><span>Top 5</span></header>
        <ol data-slot-least>
          <li v-for="(slot, index) in quietestSlots" :key="slot.key">
            <b>{{ index + 1 }}</b>
            <strong>{{ slot.label }}</strong>
            <mark>{{ slot.total }}</mark>
          </li>
        </ol>
      </section>
    </div>
  </section>
</template>
