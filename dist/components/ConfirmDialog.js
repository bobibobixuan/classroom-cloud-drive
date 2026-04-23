import { onMounted, onUnmounted } from '../deps.js';
import { uiState, resolveConfirm } from '../ui.js';

export default {
  name: 'ConfirmDialog',
  setup() {
    const onKeydown = (event) => {
      if (event.key === 'Escape' && uiState.confirm.open) {
        resolveConfirm(false);
      }
    };

    onMounted(() => {
      document.addEventListener('keydown', onKeydown);
    });

    onUnmounted(() => {
      document.removeEventListener('keydown', onKeydown);
    });

    return {
      uiState,
      resolveConfirm,
    };
  },
  template: `
    <div
      v-if="uiState.confirm.open"
      class="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/45 px-4"
      @click.self="resolveConfirm(false)"
    >
      <div class="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl">
        <h3 class="text-xl font-semibold text-slate-900">{{ uiState.confirm.title }}</h3>
        <p class="mt-3 text-sm leading-7 text-slate-500">{{ uiState.confirm.message }}</p>
        <div class="mt-6 flex justify-end gap-3">
          <button
            class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700"
            @click="resolveConfirm(false)"
          >
            {{ uiState.confirm.cancelText }}
          </button>
          <button
            class="rounded-2xl px-4 py-2 text-sm font-semibold text-white"
            :class="uiState.confirm.danger ? 'bg-rose-600' : 'bg-sky-600'"
            @click="resolveConfirm(true)"
          >
            {{ uiState.confirm.confirmText }}
          </button>
        </div>
      </div>
    </div>
  `,
};
