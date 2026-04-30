import { readonly, ref } from "vue";

export type MessageType = "success" | "error" | "warning" | "info";

export interface AppMessageItem {
  id: number;
  type: MessageType;
  text: string;
  duration: number;
}

const messages = ref<AppMessageItem[]>([]);

let messageId = 0;

/**
 * 新增一条全局消息。
 */
function pushMessage(type: MessageType, text: string, duration = 2500) {
  const id = ++messageId;

  messages.value.push({
    id,
    type,
    text,
    duration,
  });

  if (duration > 0) {
    window.setTimeout(() => {
      removeMessage(id);
    }, duration);
  }

  return id;
}

/**
 * 移除指定消息。
 */
function removeMessage(id: number) {
  messages.value = messages.value.filter((item) => item.id !== id);
}

/**
 * 清空所有全局消息。
 */
function clearMessages() {
  messages.value = [];
}

/**
 * 统一消息提示能力。
 */
export function useMessage() {
  return {
    messages: readonly(messages),
    success(text: string, duration?: number) {
      return pushMessage("success", text, duration);
    },
    error(text: string, duration?: number) {
      return pushMessage("error", text, duration);
    },
    warning(text: string, duration?: number) {
      return pushMessage("warning", text, duration);
    },
    info(text: string, duration?: number) {
      return pushMessage("info", text, duration);
    },
    remove: removeMessage,
    clear: clearMessages,
  };
}
