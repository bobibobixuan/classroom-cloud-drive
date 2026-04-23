import { computed, RouterLink, useRoute } from '../deps.js';
import { actions, state } from '../store.js';
import { toggleChat, openRename, openSecurity } from '../ui.js';
import { splitAccountDisplay } from '../utils.js';

export default {
  name: 'Sidebar',
  components: { RouterLink },
  setup() {
    const route = useRoute();
    const hasAdminScope = (scope) => state.isSuperAdmin || (state.adminScopes || []).includes(scope);
    const navItems = computed(() => {
      const items = [
        { to: '/drive', label: '个人云盘', icon: '盘' },
        { to: '/repos/mine', label: '我的仓库', icon: '库' },
        { to: '/repos/hall', label: '仓库大厅', icon: '厅' },
      ];
      if (state.isAdmin) {
        items.push({ to: '/admin/users', label: '管理员配置', icon: '管' });
        if (hasAdminScope('audit_logs')) {
          items.push({ to: '/admin/logs', label: '操作日志', icon: '志' });
        }
      }
      return items;
    });

    const currentPath = computed(() => route.path);
    const isItemActive = (item) => currentPath.value === item.to;
    const accountDisplay = computed(() => splitAccountDisplay(state.user, state.realName));

    return {
      actions,
      state,
      accountDisplay,
      navItems,
      currentPath,
      isItemActive,
      toggleChat,
      openRename,
      openSecurity,
    };
  },
  template: `
    <aside class="flex w-20 shrink-0 flex-col border-r border-slate-200/70 bg-white/90 px-3 py-5 backdrop-blur xl:w-72 xl:px-5">
      <div class="rounded-[28px] bg-slate-950 px-4 py-4 text-white shadow-xl">
        <div class="text-lg font-semibold xl:text-xl">课堂云盘</div>
      </div>

      <nav class="mt-6 flex flex-1 flex-col gap-2">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold transition"
          :class="isItemActive(item) ? 'bg-sky-600 text-white shadow-lg shadow-sky-200' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'"
        >
          <span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-current/15 bg-current/10 text-sm font-bold">
            {{ item.icon }}
          </span>
          <span class="hidden xl:block">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="mt-6 rounded-[28px] border border-slate-200 bg-slate-50 px-3 py-4 text-slate-700 xl:px-4">
        <div class="hidden xl:block">
          <div class="flex flex-wrap items-baseline gap-2 text-sm font-semibold text-slate-900">
            <span>{{ accountDisplay.primary || '未登录' }}</span>
            <span v-if="accountDisplay.secondary" class="text-xs font-medium text-slate-400">{{ accountDisplay.secondary }}</span>
          </div>
          <div class="mt-1 text-xs text-slate-500">{{ state.isAdmin ? '管理员权限已激活' : '普通用户' }}</div>
        </div>
        <div class="mt-3 flex flex-col gap-2">
          <button class="rounded-2xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white" @click="toggleChat(true)">
            <span class="xl:hidden">聊</span>
            <span class="hidden xl:inline">打开聊天抽屉</span>
          </button>
          <button class="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold" @click="openRename">
            <span class="xl:hidden">名</span>
            <span class="hidden xl:inline">修改用户名</span>
          </button>
          <button class="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold" @click="openSecurity">
            <span class="xl:hidden">安</span>
            <span class="hidden xl:inline">账号安全</span>
          </button>
          <button class="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600" @click="actions.logout()">
            <span class="xl:hidden">退</span>
            <span class="hidden xl:inline">退出登录</span>
          </button>
        </div>
      </div>
    </aside>
  `,
};
