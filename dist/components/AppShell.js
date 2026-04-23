import { computed, onMounted, onUnmounted, ref, RouterView, useRoute, useRouter } from '../deps.js';
import { actions, state } from '../store.js';
import { showToast, uiState, toggleChat } from '../ui.js';
import { splitAccountDisplay } from '../utils.js';
import Sidebar from './Sidebar.js';
import ChatDrawer from './ChatDrawer.js';
import ToastStack from './ToastStack.js';
import ConfirmDialog from './ConfirmDialog.js';
import AccountDialogs from './AccountDialogs.js';

export default {
  name: 'AppShell',
  components: {
    Sidebar,
    ChatDrawer,
    RouterView,
    ToastStack,
    ConfirmDialog,
    AccountDialogs,
  },
  setup() {
    const route = useRoute();
    const router = useRouter();
    const pageTitle = computed(() => route.meta.title || '工作台');
    const notificationsOpen = ref(false);
    const unreadCount = computed(() => state.notificationUnreadCount || 0);
    const accountDisplay = computed(() => splitAccountDisplay(state.user, state.realName));
    let refreshTimer = null;

    const refreshHeaderState = async () => {
      if (!state.token) return;
      try {
        await Promise.all([actions.refreshIdentity(), actions.loadNotifications()]);
      } catch (error) {
        if (error?.code !== 'AUTH_EXPIRED') {
          console.error(error);
        }
      }
    };

    onMounted(async () => {
      await refreshHeaderState();
      refreshTimer = window.setInterval(refreshHeaderState, 15000);
    });

    onUnmounted(() => {
      if (refreshTimer) {
        window.clearInterval(refreshTimer);
        refreshTimer = null;
      }
    });

    const toggleNotifications = async () => {
      notificationsOpen.value = !notificationsOpen.value;
      if (notificationsOpen.value) {
        try {
          await actions.loadNotifications();
        } catch (error) {
          showToast(error.message || '加载通知失败', 'error');
        }
      }
    };

    const markNotificationsRead = async () => {
      try {
        await actions.markNotificationsRead();
      } catch (error) {
        showToast(error.message || '标记通知失败', 'error');
      }
    };

    const closeNotifications = () => {
      notificationsOpen.value = false;
    };

    const openNotification = async (notification) => {
      closeNotifications();
      if (notification?.link) {
        await router.push(notification.link);
      }
    };

    return {
      actions,
      state,
      uiState,
      accountDisplay,
      pageTitle,
      notificationsOpen,
      unreadCount,
      toggleChat,
      toggleNotifications,
      closeNotifications,
      markNotificationsRead,
      openNotification,
    };
  },
  template: `
    <div class="min-h-screen overflow-hidden">
      <div class="flex min-h-screen">
        <Sidebar />
        <div class="relative flex min-h-screen min-w-0 flex-1 overflow-hidden">
          <main class="min-h-screen min-w-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6" :class="uiState.chatOpen ? 'md:pr-[27.5rem]' : ''">
            <div class="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-[30px] border border-white/70 bg-white/80 px-5 py-4 shadow-lg shadow-slate-200/60 backdrop-blur">
              <div>
                <div class="text-sm font-medium uppercase tracking-[0.24em] text-sky-600">Workspace</div>
                <h1 class="mt-1 text-2xl font-bold text-slate-900 md:text-3xl">{{ pageTitle }}</h1>
              </div>
              <div class="relative flex flex-wrap items-center gap-2">
                <span class="inline-flex items-baseline gap-2 rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
                  <span>{{ accountDisplay.primary || '未登录' }}</span>
                  <span v-if="accountDisplay.secondary" class="font-medium text-sky-500/70">{{ accountDisplay.secondary }}</span>
                </span>
                <span v-if="state.isAdmin" class="rounded-full px-3 py-1 text-xs font-semibold" :class="state.isSuperAdmin ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'">
                  {{ state.isSuperAdmin ? '超级管理员' : '子管理员' }}
                </span>
                <button class="relative rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700" @click="toggleNotifications">
                  通知
                  <span v-if="unreadCount" class="absolute -right-1 -top-1 inline-flex min-h-[1.25rem] min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white">
                    {{ unreadCount > 99 ? '99+' : unreadCount }}
                  </span>
                </button>
                <button class="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700" @click="toggleChat(true)">
                  聊天
                </button>
              </div>
            </div>

            <div class="rounded-[32px] border border-white/70 bg-white/75 p-4 shadow-xl shadow-slate-200/60 backdrop-blur md:p-6">
              <RouterView />
            </div>
          </main>

          <div
            class="fixed inset-y-0 right-0 z-30 hidden h-screen w-[26rem] max-w-full overflow-hidden border-l border-slate-200/80 bg-white/92 shadow-2xl transition-transform duration-300 md:block"
            :class="uiState.chatOpen ? 'translate-x-0' : 'translate-x-full'"
          >
            <ChatDrawer />
          </div>
        </div>
      </div>

      <div v-if="notificationsOpen" class="fixed inset-0 z-[60] bg-slate-950/10" @click="closeNotifications"></div>
      <div v-if="notificationsOpen" class="fixed inset-x-4 top-24 z-[70] overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl shadow-slate-200/70 md:inset-x-auto md:right-6 md:top-24 md:w-full md:max-w-md">
        <div class="flex items-center justify-between border-b border-slate-200 px-4 py-4">
          <div>
            <div class="text-sm font-semibold text-slate-900">消息栏</div>
            <div class="mt-1 text-xs text-slate-500">任何与你有关的审批、协作和权限变化都会在这里提示。</div>
          </div>
          <button class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600" @click="markNotificationsRead">
            全部已读
          </button>
        </div>

        <div v-if="state.notifications.length" class="max-h-[26rem] overflow-y-auto px-3 py-3">
          <button
            v-for="item in state.notifications"
            :key="item.id"
            class="mb-2 block w-full rounded-3xl border px-4 py-3 text-left transition last:mb-0"
            :class="item.is_read ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-sky-200 bg-sky-50 text-slate-800'"
            @click="openNotification(item)"
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="text-sm font-semibold">{{ item.title }}</div>
                <div v-if="item.detail" class="mt-1 text-sm leading-6">{{ item.detail }}</div>
              </div>
              <span v-if="!item.is_read" class="mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-rose-500"></span>
            </div>
            <div class="mt-2 text-xs text-slate-400">{{ item.created_at }}</div>
          </button>
        </div>

        <div v-else class="px-4 py-10 text-center text-sm text-slate-500">
          暂时没有新通知。
        </div>
      </div>

      <div v-if="uiState.chatOpen" class="fixed inset-0 z-40 bg-slate-950/30 md:hidden" @click="toggleChat(false)"></div>
      <div v-if="uiState.chatOpen" class="fixed inset-y-0 right-0 z-50 w-full max-w-sm border-l border-slate-200 bg-white shadow-2xl md:hidden">
        <ChatDrawer />
      </div>

      <ToastStack />
      <ConfirmDialog />
      <AccountDialogs />
    </div>
  `,
};
