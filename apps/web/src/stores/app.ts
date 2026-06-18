import { defineStore } from 'pinia'
import { useDark, useToggle } from '@vueuse/core'
import { ref } from 'vue'

export const useAppStore = defineStore('app', () => {
  // 1. 明暗主题状态控制
  // 自动判断系统偏好，并绑定到 html 上的 class="dark"
  const isDark = useDark()
  const toggleDark = useToggle(isDark)

  // 2. 侧边栏抽屉状态 (移动端适配)
  const isSidebarOpen = ref(false)
  const toggleSidebar = () => {
    isSidebarOpen.value = !isSidebarOpen.value
  }

  // 3. 全局命令面板 (Command Palette) 状态
  const isCommandPaletteOpen = ref(false)
  const toggleCommandPalette = () => {
    isCommandPaletteOpen.value = !isCommandPaletteOpen.value
  }

  return {
    isDark,
    toggleDark,
    isSidebarOpen,
    toggleSidebar,
    isCommandPaletteOpen,
    toggleCommandPalette
  }
})
