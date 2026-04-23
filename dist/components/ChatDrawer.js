import { computed, nextTick, onMounted, ref, watch } from '../deps.js';
import { actions, isBusy, state } from '../store.js';
import { confirmAction, toggleChat, showToast, uiState } from '../ui.js';
import { resolveChatImageSrc, splitAccountDisplay } from '../utils.js';

export default {
  name: 'ChatDrawer',
  setup() {
    const draft = ref('');
    const messageBox = ref(null);
    const imageInput = ref(null);
    const previewSrc = ref('');
    const shouldStickToBottom = ref(true);

    const canSend = computed(() => !isBusy('chat-send'));
    const canSendImage = computed(() => !isBusy('chat-image-send'));
    const canReset = computed(() => state.isAdmin && !isBusy('chat-reset'));
    const showJumpToBottom = computed(() => !shouldStickToBottom.value && !!state.chatMessages.length);

    const handleScroll = () => {
      const box = messageBox.value;
      if (!box) return;
      shouldStickToBottom.value = box.scrollHeight - box.scrollTop <= box.clientHeight + 100;
    };

    const jumpToBottom = async (behavior = 'smooth') => {
      await nextTick();
      const box = messageBox.value;
      if (!box) return;
      box.scrollTo({ top: box.scrollHeight, behavior });
      shouldStickToBottom.value = true;
    };

    const syncScroll = async (force = false) => {
      await nextTick();
      const box = messageBox.value;
      if (!box) return;
      const nearBottom = box.scrollHeight - box.scrollTop <= box.clientHeight + 100;
      if (force || nearBottom || shouldStickToBottom.value) {
        box.scrollTo({ top: box.scrollHeight, behavior: force ? 'auto' : 'smooth' });
        shouldStickToBottom.value = true;
      }
    };

    watch(
      () => state.chatMessages,
      async () => {
        await syncScroll();
      },
    );

    watch(
      () => uiState.chatOpen,
      async (open) => {
        if (open) {
          await jumpToBottom('auto');
        }
      },
    );

    onMounted(async () => {
      if (!state.chatMessages.length) {
        try {
          await actions.loadChat();
        } catch (error) {
          showToast(error.message || '加载聊天失败', 'error');
        }
      }
      await jumpToBottom('auto');
    });

    const submitMessage = async () => {
      const nextValue = draft.value.trim();
      if (!nextValue) return;
      try {
        await actions.sendChat(nextValue);
        draft.value = '';
        await jumpToBottom('auto');
      } catch (error) {
        showToast(error.message || '发送消息失败', 'error');
      }
    };

    const onEnter = async (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        await submitMessage();
      }
    };

    const sendImage = async (event) => {
      const [file] = event.target.files || [];
      if (!file) return;
      try {
        await actions.sendImageToChat(file);
        showToast('图片已发送', 'success');
        await jumpToBottom('auto');
      } catch (error) {
        showToast(error.message || '发送图片失败', 'error');
      } finally {
        event.target.value = '';
      }
    };

    const triggerImageSelect = () => {
      imageInput.value?.click();
    };

    const downloadShare = async (code) => {
      try {
        await actions.downloadShare(code);
      } catch (error) {
        showToast(error.message || '下载分享文件失败', 'error');
      }
    };

    const resetChat = async () => {
      if (!(await confirmAction({ title: '清空聊天记录', message: '确定清空课堂聊天记录吗？此操作不可恢复。', confirmText: '确认清空' }))) {
        return;
      }
      try {
        await actions.resetChat();
        showToast('聊天记录已清空', 'success');
      } catch (error) {
        showToast(error.message || '清空聊天失败', 'error');
      }
    };

    const getMessageDisplay = (message) => splitAccountDisplay(message?.user || '', message?.real_name || '');

    return {
      state,
      uiState,
      draft,
      messageBox,
      imageInput,
      previewSrc,
      showJumpToBottom,
      canSend,
      canSendImage,
      canReset,
      toggleChat,
      handleScroll,
      jumpToBottom,
      submitMessage,
      onEnter,
      sendImage,
      triggerImageSelect,
      downloadShare,
      resetChat,
      getMessageDisplay,
      resolveChatImageSrc,
    };
  },
  template: `
    <div class="flex h-full min-h-0 flex-col bg-white">
      <div class="shrink-0 border-b border-slate-200 px-5 py-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold text-slate-900">课堂聊天抽屉</h2>
            <p class="mt-1 text-sm leading-6 text-slate-500">文明发言，恶语伤人心</p>
          </div>
          <button class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600" @click="toggleChat(false)">
            关闭
          </button>
        </div>
        <div class="mt-3 flex gap-2" v-if="state.isAdmin">
          <button
            class="rounded-2xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600"
            :disabled="!canReset"
            @click="resetChat"
          >
            {{ canReset ? '清空聊天' : '处理中' }}
          </button>
        </div>
      </div>

      <div class="relative min-h-0 flex-1 overflow-hidden">
        <div ref="messageBox" class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto bg-slate-50/70 px-4 py-4" @scroll="handleScroll">
        <div v-if="!state.chatMessages.length" class="rounded-3xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
          聊天室已清空。现在这里还没有消息。
        </div>
        <article v-for="(message, index) in state.chatMessages" :key="(message.time || 't') + '-' + (message.user || 'u') + '-' + index" class="rounded-3xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <header class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-baseline gap-2">
              <strong class="truncate text-sm font-semibold text-sky-700">{{ getMessageDisplay(message).primary || '匿名' }}</strong>
              <span v-if="getMessageDisplay(message).secondary" class="truncate text-xs font-medium text-slate-400">{{ getMessageDisplay(message).secondary }}</span>
            </div>
            <span class="text-xs text-slate-400">{{ message.time || '' }}</span>
          </header>
          <p v-if="message.text" class="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">{{ message.text }}</p>
          <img
            v-if="message.image"
            class="mt-3 max-h-64 w-full cursor-zoom-in rounded-2xl border border-slate-200 object-cover"
            :src="resolveChatImageSrc(message.image)"
            alt="聊天图片"
            @click="previewSrc = resolveChatImageSrc(message.image)"
          >
          <button
            v-if="message.code"
            class="mt-3 w-full rounded-2xl bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700"
            @click="downloadShare(message.code)"
          >
            下载云盘分享文件
          </button>
        </article>
        </div>
        <button
          v-if="showJumpToBottom"
          class="absolute bottom-4 right-4 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-xs font-semibold text-slate-700 shadow-xl"
          @click="jumpToBottom()"
        >
          回到最新消息
        </button>
      </div>

      <div class="shrink-0 border-t border-slate-200 bg-white px-4 py-4">
        <div class="mb-3 flex items-center justify-between gap-3 rounded-[24px] bg-slate-50 px-4 py-3 text-xs text-slate-500">
          <span>Enter 发送，Shift + Enter 换行。发送后会自动定位到最新消息。</span>
          <button v-if="state.chatMessages.length" class="font-semibold text-sky-700" @click="jumpToBottom()">最新</button>
        </div>
        <textarea
          v-model="draft"
          class="min-h-[88px] w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-0"
          placeholder="输入消息，支持连续对话；按 Enter 发送，Shift + Enter 换行"
          @keydown="onEnter"
        ></textarea>
        <div class="mt-3 flex items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <input ref="imageInput" class="hidden" type="file" accept="image/*" @change="sendImage">
            <button
              class="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              :disabled="!canSendImage"
              @click="triggerImageSelect"
            >
              {{ canSendImage ? '发送图片' : '发送中' }}
            </button>
          </div>
          <button
            class="rounded-2xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-200"
            :disabled="!canSend"
            @click="submitMessage"
          >
            {{ canSend ? '发送消息' : '发送中' }}
          </button>
        </div>
      </div>

      <div v-if="previewSrc" class="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/70 p-6" @click.self="previewSrc = ''">
        <div class="flex max-h-full max-w-3xl flex-col items-center">
          <img :src="previewSrc" alt="预览图片" class="max-h-[78vh] max-w-full rounded-[28px] bg-white shadow-2xl">
          <button class="mt-4 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold text-white" @click="previewSrc = ''">
            关闭预览
          </button>
        </div>
      </div>
    </div>
  `,
};
