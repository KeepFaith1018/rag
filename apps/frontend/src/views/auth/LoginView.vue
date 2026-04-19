<script setup lang="ts">
import { ref } from "vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import { useRouter } from "vue-router";
const router = useRouter();

// 控制当前显示的是登录表单还是注册表单
const isLoginMode = ref(true);

// 登录表单数据
const loginForm = ref({
  email: "",
  password: "",
  rememberMe: false,
});

// 注册表单数据
const registerForm = ref({
  email: "",
  verificationCode: "",
  password: "",
  confirmPassword: "",
});

const handleLogin = () => {
  console.log("Login attempt:", loginForm.value);
  // TODO: 调用后端登录 API
  router.push("/");
};

const handleRegister = () => {
  console.log("Register attempt:", registerForm.value);
  // TODO: 调用后端注册 API
};

const sendVerificationCode = () => {
  console.log("Send code to:", registerForm.value.email);
  // TODO: 调用发送验证码 API
};
</script>

<template>
  <main class="flex h-screen w-full relative overflow-hidden bg-surface">
    <!-- 左侧视觉区域 (仅桌面端显示) -->
    <div
      class="hidden lg:flex lg:w-3/5 bg-surface-container-lowest relative overflow-hidden items-center justify-center border-r-0 border-transparent"
    >
      <div class="absolute inset-0 blueprint-grid"></div>

      <!-- 动态渐变光球 -->
      <div
        class="absolute top-1/4 -left-20 w-96 h-96 bg-primary-container opacity-20 blur-[120px] rounded-full pointer-events-none"
      ></div>
      <div
        class="absolute bottom-1/4 -right-20 w-80 h-80 bg-primary opacity-10 blur-[100px] rounded-full pointer-events-none"
      ></div>

      <!-- 核心文案区 -->
      <div class="relative z-10 p-16 max-w-2xl">
        <div class="flex items-center gap-3 mb-8">
          <div
            class="w-10 h-10 bg-primary-container flex items-center justify-center rounded-lg shadow-[0_0_20px_var(--color-primary-container)]"
          >
            <span
              class="material-symbols-outlined text-on-primary-container icon-filled"
              >bolt</span
            >
          </div>
          <span
            class="font-headline font-bold text-2xl tracking-tighter text-primary"
            >LINSOR_AI</span
          >
        </div>

        <h1
          class="font-headline text-5xl font-bold tracking-tight text-on-surface mb-6 leading-tight"
        >
          <span class="text-primary">认知增强</span>的<br />私有知识库
        </h1>
        <p
          class="text-on-surface-variant text-lg leading-relaxed mb-12 font-light max-w-md"
        >
          基于 Agentic RAG
          架构。将您的散落文档转化为高精度的问答智能体，灵动搜索个人知识。
        </p>

        <!-- 数据面板 -->
        <div class="grid grid-cols-2 gap-8 max-w-lg">
          <div
            class="p-6 bg-surface-container-low rounded-xl border border-outline-variant/10 backdrop-blur-sm"
          >
            <span
              class="text-primary font-headline text-3xl font-bold block mb-1"
              >RAG</span
            >
            <span
              class="text-label uppercase tracking-wider text-on-surface-variant text-[10px] font-medium"
              >检索增强生成架构</span
            >
          </div>
          <div
            class="p-6 bg-surface-container-low rounded-xl border border-outline-variant/10 backdrop-blur-sm"
          >
            <span
              class="text-primary font-headline text-3xl font-bold block mb-1"
              >100%</span
            >
            <span
              class="text-label uppercase tracking-wider text-on-surface-variant text-[10px] font-medium"
              >私有数据盲区保护</span
            >
          </div>
        </div>
      </div>

      <!-- 抽象网格装饰图 -->
      <div
        class="absolute bottom-0 right-0 w-full h-full opacity-40 pointer-events-none"
      >
        <div
          class="absolute bottom-10 right-10 w-[600px] h-[600px]"
          style="
            background-image: url(&quot;https://lh3.googleusercontent.com/aida-public/AB6AXuAdIDJ6eehA0h25Dz1XlB54QHxttnZnkFTpOcYkofSXxS-LQCur690_YDm-sdv8aFo3qfWLfHWhIRkMMFIgu8LMU2XGxRVL-Xok9_SBwY1P6RisQeLXYfQDYK81rVOTGRaBQnr4-R7ABj_0uTSAkvrn9S9-vxnGklfyRt-an9y8CVJU0-2HMUUFlv3BHUS-tjQcW4l7hJR8ZqHBJY6QbmrOOIYJM7fBv4JsXwv3vqYaypgqERcsWaIu4scSsdGo59tdp1pWKGPgjTJP&quot;);
            background-size: cover;
            background-position: center;
            filter: grayscale(100%) contrast(120%);
            mask-image: radial-gradient(circle, black 30%, transparent 70%);
          "
        ></div>
      </div>
    </div>

    <!-- 右侧表单区域 -->
    <div
      class="w-full lg:w-2/5 flex flex-col items-center justify-center bg-surface px-8 sm:px-16 lg:px-20 relative z-20 overflow-y-auto"
    >
      <div class="w-full max-w-md py-12">
        <!-- 移动端顶部 Logo -->
        <div class="lg:hidden flex items-center gap-2 mb-12">
          <div
            class="w-8 h-8 bg-primary-container flex items-center justify-center rounded-lg"
          >
            <span
              class="material-symbols-outlined text-on-primary-container text-sm icon-filled"
              >bolt</span
            >
          </div>
          <span
            class="font-headline font-bold text-xl tracking-tighter text-primary"
            >LINSOR_AI</span
          >
        </div>

        <!-- 标题区 -->
        <div class="mb-10 transition-all duration-300">
          <h2
            class="font-headline text-3xl font-bold tracking-tight text-on-surface mb-2"
          >
            {{ isLoginMode ? "欢迎回来" : "初始化新节点" }}
          </h2>
          <p class="text-on-surface-variant font-light text-sm">
            {{
              isLoginMode
                ? "请输入您的凭据以访问。"
                : "注册您的开发者账号以获取全量访问权限。"
            }}
          </p>
        </div>

        <!-- 视图切换过渡 -->
        <Transition name="fade-slide" mode="out-in">
          <!-- 登录表单 -->
          <form
            v-if="isLoginMode"
            @submit.prevent="handleLogin"
            class="space-y-6"
          >
            <div class="space-y-2">
              <label
                class="block text-[11px] font-label uppercase tracking-[0.1em] text-on-surface-variant font-medium"
                >电子邮箱</label
              >
              <BaseInput
                v-model="loginForm.email"
                type="email"
                placeholder="name@linsor.ai"
                required
              >
                <template #icon>
                  <span class="material-symbols-outlined text-lg"
                    >alternate_email</span
                  >
                </template>
              </BaseInput>
            </div>

            <div class="space-y-2">
              <div class="flex justify-between items-center">
                <label
                  class="block text-[11px] font-label uppercase tracking-[0.1em] text-on-surface-variant font-medium"
                  >密码</label
                >
                <a
                  href="#"
                  class="text-[10px] font-label font-medium text-primary hover:text-on-surface transition-colors uppercase tracking-wider"
                  >忘记密码？</a
                >
              </div>
              <BaseInput
                v-model="loginForm.password"
                type="password"
                placeholder="••••••••"
                required
              >
                <template #icon>
                  <span
                    class="material-symbols-outlined text-lg cursor-pointer hover:text-on-surface"
                    >visibility_off</span
                  >
                </template>
              </BaseInput>
            </div>

            <div class="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="remember"
                v-model="loginForm.rememberMe"
                class="w-4 h-4 rounded border-outline-variant/30 bg-surface-container-highest text-primary focus:ring-offset-surface focus:ring-primary accent-primary cursor-pointer"
              />
              <label
                for="remember"
                class="text-sm text-on-surface-variant cursor-pointer select-none"
                >保持登录状态 30 天</label
              >
            </div>

            <div class="pt-4">
              <BaseButton type="submit" variant="primary" class="w-full py-3">
                执行登录
                <span class="material-symbols-outlined text-sm"
                  >arrow_forward</span
                >
              </BaseButton>
            </div>
          </form>

          <!-- 注册表单 -->
          <form v-else @submit.prevent="handleRegister" class="space-y-5">
            <div class="space-y-2">
              <label
                class="block text-[11px] font-label uppercase tracking-[0.1em] text-on-surface-variant font-medium"
                >电子邮箱</label
              >
              <BaseInput
                v-model="registerForm.email"
                type="email"
                placeholder="name@linsor.ai"
                required
              >
                <template #icon>
                  <span class="material-symbols-outlined text-lg"
                    >alternate_email</span
                  >
                </template>
              </BaseInput>
            </div>

            <!-- 验证码 -->
            <div class="space-y-2">
              <label
                class="block text-[11px] font-label uppercase tracking-[0.1em] text-on-surface-variant font-medium"
                >验证码</label
              >
              <div class="flex gap-3">
                <BaseInput
                  v-model="registerForm.verificationCode"
                  type="text"
                  placeholder="6位数字"
                  required
                  class="flex-1 text-center font-mono tracking-widest"
                />
                <BaseButton
                  type="button"
                  variant="outline"
                  class="whitespace-nowrap px-6"
                  @click="sendVerificationCode"
                >
                  发送验证码
                </BaseButton>
              </div>
            </div>

            <div class="space-y-2">
              <label
                class="block text-[11px] font-label uppercase tracking-[0.1em] text-on-surface-variant font-medium"
                >密码</label
              >
              <BaseInput
                v-model="registerForm.password"
                type="password"
                placeholder="设置高强度密码"
                required
              />
            </div>

            <div class="space-y-2">
              <label
                class="block text-[11px] font-label uppercase tracking-[0.1em] text-on-surface-variant font-medium"
                >确认密码</label
              >
              <BaseInput
                v-model="registerForm.confirmPassword"
                type="password"
                placeholder="再次输入密码"
                required
              />
            </div>

            <div class="pt-4">
              <BaseButton type="submit" variant="primary" class="w-full py-3">
                部署新账号
                <span class="material-symbols-outlined text-sm"
                  >rocket_launch</span
                >
              </BaseButton>
            </div>
          </form>
        </Transition>

        <!-- 模式切换触发器 -->
        <div class="mt-12 pt-8 border-t border-outline-variant/10 text-center">
          <p
            class="text-xs text-on-surface-variant uppercase tracking-widest font-medium"
          >
            {{ isLoginMode ? "新用户？" : "已有凭据？" }}
            <a
              href="#"
              @click.prevent="isLoginMode = !isLoginMode"
              class="text-primary hover:text-on-primary-container transition-colors underline decoration-primary/30 underline-offset-4 cursor-pointer ml-1"
            >
              {{ isLoginMode ? "申请账户" : "返回终端" }}
            </a>
          </p>
        </div>
      </div>

      <!-- 底部极简链接 -->
      <div
        class="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-6 whitespace-nowrap opacity-40"
      >
        <a
          href="#"
          class="text-[10px] uppercase tracking-[0.2em] font-label hover:opacity-100 hover:text-primary transition-all"
          >隐私政策</a
        >
        <a
          href="#"
          class="text-[10px] uppercase tracking-[0.2em] font-label hover:opacity-100 hover:text-primary transition-all"
          >技术文档</a
        >
        <a
          href="#"
          class="text-[10px] uppercase tracking-[0.2em] font-label hover:opacity-100 hover:text-primary transition-all"
          >状态</a
        >
      </div>
    </div>
  </main>
</template>

<style scoped>
/* 视图切换动画：平滑的淡入淡出和微小位移 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
