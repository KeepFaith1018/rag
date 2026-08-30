<script setup lang="ts">
interface Props {
  variant?: 'primary' | 'outline' | 'ghost'
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  type: 'button',
  disabled: false,
  class: ''
})
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    :class="[
      'base-button',
      `base-button--${variant}`,
      props.class
    ]"
  >
    <slot />
  </button>
</template>

<style scoped lang="scss">
.base-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-button);
  font-family: var(--font-family-headline);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  transition:
    color var(--duration-normal) var(--ease-standard),
    background-color var(--duration-normal) var(--ease-standard),
    border-color var(--duration-normal) var(--ease-standard),
    filter var(--duration-normal) var(--ease-standard),
    transform var(--duration-normal) var(--ease-standard);

  &:active:not(:disabled) {
    transform: scale(0.98);
  }

  &:focus-visible {
    outline: 2px solid var(--focus-ring-color);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }

  &--primary {
    background-color: var(--color-primary-container);
    color: var(--color-on-primary-container);

    &:hover:not(:disabled) {
      filter: brightness(1.1);
    }
  }

  &--outline {
    border-color: color-mix(in srgb, var(--color-outline-variant) 30%, transparent);
    background-color: transparent;
    color: var(--color-on-surface);

    &:hover:not(:disabled) {
      background-color: var(--color-surface-container-high);
    }
  }

  &--ghost {
    background-color: transparent;
    color: var(--color-on-surface);

    &:hover:not(:disabled) {
      background-color: var(--color-surface-container-high);
    }
  }
}
</style>
