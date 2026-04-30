import { computed, onBeforeUnmount, ref } from "vue";

const DEFAULT_SECONDS = 30;

/**
 * 验证码发送倒计时。
 */
export function useVerificationCountdown(defaultSeconds = DEFAULT_SECONDS) {
  const remainingSeconds = ref(0);
  let timerId: number | null = null;

  const isCountingDown = computed(() => remainingSeconds.value > 0);
  const buttonText = computed(() => {
    return isCountingDown.value
      ? `${remainingSeconds.value}s 后重试`
      : "发送验证码";
  });

  /**
   * 启动倒计时。
   */
  function start(seconds = defaultSeconds) {
    stop();
    remainingSeconds.value = seconds;

    timerId = window.setInterval(() => {
      if (remainingSeconds.value <= 1) {
        stop();
        return;
      }

      remainingSeconds.value -= 1;
    }, 1000);
  }

  /**
   * 停止倒计时。
   */
  function stop() {
    if (timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }

    remainingSeconds.value = 0;
  }

  onBeforeUnmount(() => {
    stop();
  });

  return {
    remainingSeconds,
    isCountingDown,
    buttonText,
    start,
    stop,
  };
}
