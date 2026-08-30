<script setup lang="ts">
interface Props {
  hoverable?: boolean
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  hoverable: false,
  class: ''
})
</script>

<template>
  <div
    :class="[
      'base-card',
      { 'base-card--hoverable': hoverable },
      props.class
    ]"
  >
    <div v-if="$slots.header" class="base-card__header">
      <slot name="header" />
    </div>

    <div class="base-card__body">
      <slot />
    </div>

    <div v-if="$slots.footer" class="base-card__footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.base-card {
  padding: var(--space-6);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  background-color: var(--color-surface-container-low);
  transition:
    background-color var(--duration-slow) var(--ease-standard),
    border-color var(--duration-slow) var(--ease-standard),
    box-shadow var(--duration-slow) var(--ease-standard),
    transform var(--duration-slow) var(--ease-standard);

  &--hoverable {
    cursor: pointer;

    &:hover {
      border-color: color-mix(in srgb, var(--color-outline-variant) 10%, transparent);
      background-color: var(--color-surface-container-high);
      box-shadow: var(--shadow-hover-value);
      transform: translateY(-0.25rem);
    }
  }

  &__header {
    margin-bottom: var(--space-4);
  }

  &__footer {
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid color-mix(in srgb, var(--color-outline-variant) 10%, transparent);
  }
}
</style>
