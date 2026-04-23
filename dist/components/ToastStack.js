import { uiState } from '../ui.js';

export default {
  name: 'ToastStack',
  setup() {
    return { uiState };
  },
  template: `
    <div class="pointer-events-none fixed right-4 top-4 z-[120] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-3">
      <div
        v-for="toast in uiState.toasts"
        :key="toast.id"
        class="rounded-2xl px-4 py-3 text-sm font-medium text-white shadow-2xl backdrop-blur"
        :class="{
          'bg-sky-600/95': toast.type === 'info',
          'bg-emerald-600/95': toast.type === 'success',
          'bg-amber-500/95': toast.type === 'warning',
          'bg-rose-600/95': toast.type === 'error',
        }"
      >
        {{ toast.message }}
      </div>
    </div>
  `,
};
