<script setup lang="ts">
interface Props {
  modelValue?: string | number
  type?: string
  placeholder?: string
  id?: string
  disabled?: boolean
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  type: 'text',
  placeholder: '',
  disabled: false,
  class: ''
})

const model = defineModel<string | number>()
</script>

<template>
  <div class="base-input">
    <input
      :id="id"
      :type="type"
      v-model="model"
      :placeholder="placeholder"
      :disabled="disabled"
      :class="[
        'base-input__control',
        props.class
      ]"
    />

    <div v-if="$slots.icon" class="base-input__icon">
      <slot name="icon" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.base-input {
  position: relative;
  width: 100%;

  &__control {
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: 1px solid color-mix(in srgb, var(--color-outline-variant) 20%, transparent);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-container-highest);
    color: var(--color-on-surface);
    font-size: var(--font-size-sm);
    transition:
      border-color var(--duration-normal) var(--ease-standard),
      box-shadow var(--duration-normal) var(--ease-standard),
      opacity var(--duration-normal) var(--ease-standard);

    &::placeholder {
      color: color-mix(in srgb, var(--color-outline) 40%, transparent);
    }

    &:focus {
      border-color: var(--color-primary);
      outline: none;
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 50%, transparent);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  &__icon {
    position: absolute;
    top: 0;
    right: var(--space-3);
    bottom: 0;
    display: flex;
    align-items: center;
    color: color-mix(in srgb, var(--color-outline) 60%, transparent);
    transition: color var(--duration-normal) var(--ease-standard);
    pointer-events: none;
  }

  &:focus-within &__icon {
    color: var(--color-primary);
  }
}
</style>
