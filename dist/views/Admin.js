import { computed, onMounted, reactive, ref, RouterLink, useRoute, useRouter, watch } from '../deps.js';
import { actions, state } from '../store.js';
import { confirmAction, showToast } from '../ui.js';
import { formatSize, splitAccountDisplay } from '../utils.js';

const scopeOptions = [
  { value: 'user_lifecycle', label: '账号管理' },
  { value: 'quota_management', label: '配额管理' },
  { value: 'transfer_ownership', label: '所有权转移' },
  { value: 'share_governance', label: '分享治理' },
  { value: 'storage_cleanup', label: '回收站清理' },
  { value: 'audit_logs', label: '审计日志' },
];

const defaultAdminScopes = ['user_lifecycle', 'quota_management', 'transfer_ownership', 'share_governance', 'audit_logs'];

const userPanels = [
  { key: 'directory', title: '用户目录', description: '创建账号、调整角色、配额与资产。' },
  { key: 'whitelist', title: '注册白名单', description: '导入手机号实名名单并查看注册流转。' },
];

const configSections = [
  {
    key: 'users',
    title: '用户设置',
    description: '管理账号、角色、配额和资产转移。',
    scope: 'user_lifecycle',
    route: '/admin/users',
  },
  {
    key: 'repos',
    title: '仓库设置',
    description: '查看仓库占用、成员和管理员入口。',
    scope: 'audit_logs',
    route: '/admin/repos',
  },
  {
    key: 'shares',
    title: '公开链接设置',
    description: '统一维护公开分享、密码和过期时间。',
    scope: 'share_governance',
    route: '/admin/shares',
  },
  {
    key: 'recycle',
    title: '回收站清理',
    description: '集中处理全局回收站和磁盘回收。',
    scope: 'storage_cleanup',
    route: '/admin/recycle',
  },
];

export default {
  name: 'AdminView',
  components: { RouterLink },
  setup() {
    const router = useRouter();
    const route = useRoute();
    const createForm = reactive({
      username: '',
      password: '',
      phone: '',
      role: 'user',
      quotaMb: 500,
      adminScopes: [...defaultAdminScopes],
    });
    const userDrafts = reactive({});
    const shareDrafts = reactive({});
    const whitelistInput = ref(null);
    const whitelistImportFile = ref(null);
    const activeUserPanel = ref('directory');

    const hasScope = (scope) => state.isSuperAdmin || (state.adminScopes || []).includes(scope);
    const activeSection = computed(() => route.meta.adminSection || 'users');
    const isLogsPage = computed(() => activeSection.value === 'logs');
    const availableConfigSections = computed(() => configSections.filter((section) => hasScope(section.scope)));
    const pageIntro = computed(() => {
      if (isLogsPage.value) {
        return '这里单独展示管理员操作日志，避免与配置项混在同一页。';
      }
      return '当前管理员配置已拆分为独立分区，点击上方分类查看对应设置。';
    });
    const whitelistStats = computed(() => {
      const items = state.adminRegistrationWhitelist || [];
      const pending = items.filter((item) => item.status !== 'registered').length;
      return {
        total: items.length,
        pending,
        registered: items.length - pending,
      };
    });
    const setUserPanel = (panelKey) => {
      activeUserPanel.value = panelKey;
    };

    const normalizeAdminScopes = (role, scopes) => {
      if (role !== 'admin') return [];
      return (scopes && scopes.length) ? [...scopes] : [...defaultAdminScopes];
    };

    const syncUserDraft = (user) => {
      const roleValue = user.role || (user.is_super_admin ? 'super_admin' : (user.is_admin ? 'admin' : 'user'));
      const currentDraft = userDrafts[user.username] || {};
      userDrafts[user.username] = {
        quotaMb: Math.max(1, Math.round((user.quota_bytes || 0) / 1024 / 1024)),
        password: currentDraft.password || '',
        transferTo: currentDraft.transferTo || '',
        role: roleValue,
        adminScopes: normalizeAdminScopes(roleValue, user.admin_scopes || []),
      };
      return userDrafts[user.username];
    };

    const ensureUserDraft = (user) => {
      if (!userDrafts[user.username]) {
        return syncUserDraft(user);
      }
      return userDrafts[user.username];
    };

    const ensureShareDraft = (share) => {
      if (!shareDrafts[share.code]) {
        shareDrafts[share.code] = {
          password: '',
          expiresAt: share.expires_at || '',
        };
      } else {
        shareDrafts[share.code].expiresAt = share.expires_at || '';
      }
      return shareDrafts[share.code];
    };

    const syncDrafts = () => {
      (state.adminUsers || []).forEach((user) => syncUserDraft(user));
      (state.adminShares || []).forEach((share) => ensureShareDraft(share));
    };

    const getFallbackAdminRoute = () => {
      if (availableConfigSections.value.length) {
        return availableConfigSections.value[0].route;
      }
      if (hasScope('audit_logs')) {
        return '/admin/logs';
      }
      return '/drive';
    };

    const ensureAccessibleRoute = async () => {
      if (isLogsPage.value) {
        if (!hasScope('audit_logs')) {
          const fallback = getFallbackAdminRoute();
          if (fallback !== route.path) {
            await router.replace(fallback);
          }
          return false;
        }
        return true;
      }
      if (!availableConfigSections.value.some((section) => section.key === activeSection.value)) {
        const fallback = getFallbackAdminRoute();
        if (fallback !== route.path) {
          await router.replace(fallback);
        }
        return false;
      }
      return true;
    };

    const loadSectionData = async () => {
      const tasks = [];
      if (activeSection.value === 'users' && hasScope('user_lifecycle')) {
        tasks.push(actions.loadAdminUsers());
        tasks.push(actions.loadAdminRegistrationWhitelist());
      }
      if (activeSection.value === 'repos' && hasScope('audit_logs')) tasks.push(actions.loadAdminRepos());
      if (activeSection.value === 'shares' && hasScope('share_governance')) tasks.push(actions.loadAdminShares());
      if (activeSection.value === 'recycle' && hasScope('storage_cleanup')) tasks.push(actions.loadRecycleBin());
      if (activeSection.value === 'logs' && hasScope('audit_logs')) tasks.push(actions.loadAuditLogs(200));
      await Promise.all(tasks);
      syncDrafts();
    };

    const load = async () => {
      try {
        await actions.refreshIdentity();
        const allowed = await ensureAccessibleRoute();
        if (!allowed) return;
        await loadSectionData();
      } catch (error) {
        showToast(error.message || '加载管理员控制台失败', 'error');
      }
    };

    onMounted(load);
    watch(() => route.path, () => {
      load();
    });

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

    const createUser = async () => {
      if (!createForm.username.trim() || !createForm.password || !createForm.phone.trim()) {
        showToast('请填写完整的新用户信息', 'warning');
        return;
      }
      try {
        await actions.createUserByAdmin({
          username: createForm.username,
          password: createForm.password,
          phone: createForm.phone,
          role: createForm.role,
          quotaBytes: Math.round(Number(createForm.quotaMb || 0) * 1024 * 1024),
          adminScopes: createForm.role === 'admin' ? createForm.adminScopes : [],
        });
        createForm.username = '';
        createForm.password = '';
        createForm.phone = '';
        createForm.role = 'user';
        createForm.quotaMb = 500;
        createForm.adminScopes = [...defaultAdminScopes];
        showToast('新用户已创建', 'success');
        await load();
      } catch (error) {
        showToast(error.message || '创建用户失败', 'error');
      }
    };

    const selectWhitelistFile = (event) => {
      whitelistImportFile.value = event?.target?.files?.[0] || null;
    };

    const importWhitelist = async () => {
      if (!whitelistImportFile.value) {
        showToast('请先选择 .txt 或 .csv 名单文件', 'warning');
        return;
      }
      try {
        const result = await actions.importRegistrationWhitelistByAdmin(whitelistImportFile.value);
        showToast(`白名单导入完成，新增 ${result.inserted || 0} 条，更新 ${result.updated || 0} 条`, 'success');
        whitelistImportFile.value = null;
        if (whitelistInput.value) {
          whitelistInput.value.value = '';
        }
        await load();
      } catch (error) {
        showToast(error.message || '导入白名单失败', 'error');
      }
    };

    const saveQuota = async (user) => {
      const draft = ensureUserDraft(user);
      const quotaMb = Number(draft.quotaMb || 0);
      if (!Number.isFinite(quotaMb) || quotaMb <= 0) {
        showToast('请输入有效的配额（MB）', 'warning');
        return;
      }
      try {
        await actions.updateUserQuotaByAdmin(user.username, Math.round(quotaMb * 1024 * 1024));
        showToast(`已更新 ${user.username} 的空间配额`, 'success');
        await load();
      } catch (error) {
        showToast(error.message || '更新配额失败', 'error');
      }
    };

    const resetPassword = async (user) => {
      const draft = ensureUserDraft(user);
      if (!draft.password) {
        showToast('请输入新密码', 'warning');
        return;
      }
      try {
        await actions.resetUserPasswordByAdmin(user.username, draft.password);
        draft.password = '';
        showToast(`已重置 ${user.username} 的密码`, 'success');
      } catch (error) {
        showToast(error.message || '重置密码失败', 'error');
      }
    };

    const toggleDisabled = async (user) => {
      try {
        await actions.updateUserStatusByAdmin(user.username, !user.is_disabled);
        showToast(`已更新 ${user.username} 的账号状态`, 'success');
        await load();
      } catch (error) {
        showToast(error.message || '更新账号状态失败', 'error');
      }
    };

    const toggleScopeList = (list, scope, checked) => {
      const next = new Set(list || []);
      if (checked) next.add(scope);
      else next.delete(scope);
      return Array.from(next);
    };

    const saveRole = async (user) => {
      const draft = ensureUserDraft(user);
      try {
        await actions.updateUserRoleByAdmin(
          user.username,
          draft.role,
          normalizeAdminScopes(draft.role, draft.adminScopes),
        );
        showToast(`已更新 ${user.username} 的角色`, 'success');
        await load();
      } catch (error) {
        showToast(error.message || '更新角色失败', 'error');
      }
    };

    const transferAssets = async (user) => {
      const draft = ensureUserDraft(user);
      if (!draft.transferTo.trim()) {
        showToast('请输入接收资产的账号名', 'warning');
        return;
      }
      try {
        await actions.transferUserAssetsByAdmin(user.username, draft.transferTo);
        showToast(`已转移 ${user.username} 的文件和仓库`, 'success');
        draft.transferTo = '';
        await load();
      } catch (error) {
        showToast(error.message || '转移资产失败', 'error');
      }
    };

    const deleteUser = async (user) => {
      const draft = ensureUserDraft(user);
      const transferTip = draft.transferTo.trim() ? ` 删除前会先把资产转移给 ${draft.transferTo.trim()}。` : '';
      if (!(await confirmAction({ title: '删除用户', message: `确定删除用户 ${user.username} 吗？该用户的云盘、聊天记录和其拥有的仓库都会被删除。${transferTip}`, confirmText: '删除用户' }))) {
        return;
      }
      try {
        await actions.deleteUserByAdmin(user.username, draft.transferTo || '');
        showToast(`已删除用户 ${user.username}`, 'success');
        draft.transferTo = '';
        await load();
      } catch (error) {
        showToast(error.message || '删除用户失败', 'error');
      }
    };

    const openRepo = (repoId) => {
      router.push('/repos/' + repoId);
    };

    const deleteRepo = async (repo) => {
      if (!(await confirmAction({ title: '删除仓库', message: `确定删除仓库 ${repo.name} 吗？仓库文件和成员关系都会被删除。`, confirmText: '删除仓库' }))) {
        return;
      }
      try {
        await actions.deleteRepoByAdmin(repo.id);
        showToast(`已删除仓库 ${repo.name}`, 'success');
        await load();
      } catch (error) {
        showToast(error.message || '删除仓库失败', 'error');
      }
    };

    const saveSharePolicy = async (share) => {
      const draft = ensureShareDraft(share);
      try {
        await actions.updateSharePolicyByAdmin(share.code, {
          password: draft.password,
          expiresAt: draft.expiresAt,
          revoke: false,
        });
        draft.password = '';
        showToast(`已更新分享 ${share.code} 的策略`, 'success');
        await load();
      } catch (error) {
        showToast(error.message || '更新分享策略失败', 'error');
      }
    };

    const revokeShare = async (share) => {
      if (!(await confirmAction({ title: '撤销公开分享', message: `确定撤销分享码 ${share.code} 吗？`, confirmText: '撤销分享' }))) {
        return;
      }
      try {
        await actions.revokeShareByAdmin(share.code);
        showToast(`已撤销分享 ${share.code}`, 'success');
        await load();
      } catch (error) {
        showToast(error.message || '撤销分享失败', 'error');
      }
    };

    const purgeRecycleBin = async () => {
      if (!(await confirmAction({ title: '清空全局回收站', message: '确定清空所有用户的已删除文件吗？此操作不可恢复。', confirmText: '清空回收站' }))) {
        return;
      }
      try {
        const result = await actions.purgeRecycleBinByAdmin();
        showToast(`已清空回收站，释放 ${formatSize(result.freed_bytes || 0)}`, 'success');
        await load();
      } catch (error) {
        showToast(error.message || '清空回收站失败', 'error');
      }
    };

    const toggleCreateScope = (scope, checked) => {
      createForm.adminScopes = toggleScopeList(createForm.adminScopes, scope, checked);
    };

    const toggleUserScope = (username, scope, checked) => {
      const draft = userDrafts[username];
      if (!draft) return;
      draft.adminScopes = toggleScopeList(draft.adminScopes, scope, checked);
    };

    const roleLabel = (user) => {
      if (user.is_super_admin) return '超级管理员';
      if (user.role === 'admin' || user.is_admin) return '子管理员';
      return '普通用户';
    };

    const accountDisplay = (username, realName = '') => splitAccountDisplay(username, realName);

    const scopeLabelText = (scopes) => {
      const labels = (scopes || []).map((scope) => scopeOptions.find((item) => item.value === scope)?.label || scope);
      return labels.length ? labels.join(' / ') : '无下放权限';
    };

    const formatLogTarget = (log) => `${log.target_type || 'system'} · ${log.target_id || 'n/a'}`;

    const shareStatusText = (share) => {
      if (share.revoked_at) return `已撤销：${share.revoked_at}`;
      if (share.expires_at) return `过期时间：${share.expires_at}`;
      return '未设置过期时间';
    };

    return {
      state,
      activeSection,
      isLogsPage,
      availableConfigSections,
      pageIntro,
      scopeOptions,
      load,
      resetChat,
      createForm,
      createUser,
      userPanels,
      activeUserPanel,
      setUserPanel,
      whitelistInput,
      whitelistStats,
      selectWhitelistFile,
      importWhitelist,
      ensureUserDraft,
      ensureShareDraft,
      saveQuota,
      resetPassword,
      toggleDisabled,
      saveRole,
      transferAssets,
      deleteUser,
      openRepo,
      deleteRepo,
      saveSharePolicy,
      revokeShare,
      purgeRecycleBin,
      toggleCreateScope,
      toggleUserScope,
      roleLabel,
      accountDisplay,
      scopeLabelText,
      hasScope,
      formatLogTarget,
      shareStatusText,
      formatSize,
    };
  },
  template: `
    <div class="space-y-6">
      <section class="rounded-[32px] border border-slate-200 bg-slate-50 px-6 py-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">Admin</div>
            <h2 class="mt-2 text-3xl font-bold text-slate-900">{{ isLogsPage ? '操作日志中心' : '管理员配置' }}</h2>
            <p class="mt-2 text-sm text-slate-500">{{ pageIntro }}</p>
            <p class="mt-2 text-xs text-slate-400">当前身份：{{ state.isSuperAdmin ? '超级管理员' : '子管理员' }}</p>
          </div>
          <div class="flex gap-2">
            <button class="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold" @click="load">刷新</button>
            <button v-if="!isLogsPage && hasScope('share_governance')" class="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white" @click="resetChat">清空聊天</button>
          </div>
        </div>

        <div v-if="!isLogsPage" class="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <RouterLink
            v-for="section in availableConfigSections"
            :key="section.key"
            :to="section.route"
            class="rounded-[26px] border px-4 py-4 transition"
            :class="activeSection === section.key ? 'border-sky-400 bg-sky-50 text-sky-900 shadow-lg shadow-sky-100' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-100'"
          >
            <div class="text-base font-semibold">{{ section.title }}</div>
            <div class="mt-1 text-sm text-slate-500">{{ section.description }}</div>
          </RouterLink>
        </div>
      </section>

      <section v-if="activeSection === 'users' && hasScope('user_lifecycle')" class="space-y-6">
        <section class="grid gap-3 md:grid-cols-2">
          <button
            v-for="panel in userPanels"
            :key="panel.key"
            type="button"
            class="rounded-[28px] border px-5 py-5 text-left transition"
            :class="activeUserPanel === panel.key ? 'border-sky-400 bg-sky-50 shadow-lg shadow-sky-100' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'"
            @click="setUserPanel(panel.key)"
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="text-base font-semibold text-slate-900">{{ panel.title }}</div>
                <div class="mt-1 text-sm text-slate-500">{{ panel.description }}</div>
              </div>
              <div v-if="panel.key === 'whitelist'" class="rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-500 shadow-sm">
                {{ whitelistStats.pending }} 待注册
              </div>
            </div>
          </button>
        </section>

        <section v-if="activeUserPanel === 'directory'" class="rounded-[32px] border border-slate-200 bg-white px-6 py-6 shadow-sm">
          <div class="flex items-center justify-between gap-4">
            <div>
              <h3 class="text-xl font-semibold text-slate-900">创建新用户</h3>
              <p class="mt-2 text-sm text-slate-500">超级管理员可以直接创建账号，并决定是否授予子管理员角色与初始配额。</p>
            </div>
          </div>
          <div class="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <input v-model="createForm.username" class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none" placeholder="用户名">
            <input v-model="createForm.password" type="password" class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none" placeholder="初始密码">
            <input v-model="createForm.phone" class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none" placeholder="手机号">
            <select v-model="createForm.role" class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none">
              <option value="user">普通用户</option>
              <option value="admin" :disabled="!state.isSuperAdmin">子管理员</option>
            </select>
            <input v-model="createForm.quotaMb" type="number" min="1" class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none" placeholder="配额（MB）">
          </div>
          <div v-if="createForm.role === 'admin'" class="mt-4 flex flex-wrap gap-3 rounded-[28px] bg-slate-50 px-4 py-4 text-sm text-slate-600">
            <label v-for="scope in scopeOptions" :key="scope.value" class="inline-flex items-center gap-2">
              <input type="checkbox" :checked="createForm.adminScopes.includes(scope.value)" @change="toggleCreateScope(scope.value, $event.target.checked)">
              <span>{{ scope.label }}</span>
            </label>
          </div>
          <div class="mt-5">
            <button class="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white" @click="createUser">创建用户</button>
          </div>
        </section>

        <section v-if="activeUserPanel === 'whitelist'" class="rounded-[32px] border border-slate-200 bg-white px-6 py-6 shadow-sm">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 class="text-xl font-semibold text-slate-900">注册白名单导入</h3>
              <p class="mt-2 text-sm text-slate-500">上传 .txt 或 .csv，支持“手机号,真实姓名”和“真实姓名,手机号”两种格式。导入时会自动匹配历史已注册手机号。</p>
            </div>
            <div class="rounded-[24px] bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <div>总名额 {{ whitelistStats.total }}</div>
              <div class="mt-1">待注册 {{ whitelistStats.pending }} · 已注册 {{ whitelistStats.registered }}</div>
            </div>
          </div>
          <div class="mt-5 flex flex-wrap items-center gap-3">
            <input ref="whitelistInput" type="file" accept=".txt,.csv,text/plain,text/csv" class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none" @change="selectWhitelistFile">
            <button class="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white" @click="importWhitelist">上传并导入名单</button>
          </div>
          <div class="mt-5 overflow-hidden rounded-[28px] border border-slate-200">
            <div class="grid grid-cols-[11rem_9rem_10rem_minmax(0,1fr)] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              <div>手机号</div>
              <div>真实姓名</div>
              <div>状态</div>
              <div>注册结果</div>
            </div>
            <div v-if="state.adminRegistrationWhitelist.length" class="divide-y divide-slate-100">
              <div v-for="entry in state.adminRegistrationWhitelist" :key="entry.phone" class="grid grid-cols-[11rem_9rem_10rem_minmax(0,1fr)] gap-3 px-4 py-3 text-sm text-slate-600">
                <div class="font-medium text-slate-900">{{ entry.phone }}</div>
                <div>{{ entry.real_name }}</div>
                <div>
                  <span class="rounded-full px-2 py-1 text-xs font-semibold" :class="entry.status === 'registered' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'">
                    {{ entry.status === 'registered' ? '已注册' : '待注册' }}
                  </span>
                </div>
                <div class="min-w-0">
                  <div class="truncate text-slate-900">{{ entry.registered_username || '尚未注册' }}</div>
                  <div class="mt-1 text-xs text-slate-400">导入：{{ entry.imported_at || '未知时间' }} · {{ entry.imported_by || '未知管理员' }}</div>
                  <div v-if="entry.registered_at" class="mt-1 text-xs text-slate-400">注册时间：{{ entry.registered_at }}</div>
                </div>
              </div>
            </div>
            <div v-else class="px-4 py-10 text-center text-sm text-slate-500">当前还没有导入任何注册白名单。</div>
          </div>
        </section>

        <section v-if="activeUserPanel === 'directory'" class="overflow-hidden rounded-[32px] border border-slate-200 bg-white">
          <div class="border-b border-slate-100 px-5 py-4 text-lg font-semibold text-slate-900">用户管理</div>
          <div class="divide-y divide-slate-100">
            <div v-for="user in state.adminUsers" :key="user.username" class="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <div class="flex min-w-0 flex-wrap items-baseline gap-2 font-semibold text-slate-900">
                    <span class="truncate">{{ accountDisplay(user.username, user.real_name).primary }}</span>
                    <span v-if="accountDisplay(user.username, user.real_name).secondary" class="text-xs font-medium text-slate-400">{{ accountDisplay(user.username, user.real_name).secondary }}</span>
                  </div>
                  <span class="rounded-full px-2 py-1 text-xs font-semibold" :class="user.is_super_admin ? 'bg-amber-100 text-amber-700' : (user.is_admin ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600')">{{ roleLabel(user) }}</span>
                  <span v-if="user.is_disabled" class="rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-700">已冻结</span>
                </div>
                <div class="mt-1 text-sm text-slate-500">云盘占用 {{ formatSize(user.storage) }} / {{ formatSize(user.quota_bytes) }} · 拥有仓库 {{ user.repo_count }} 个</div>
                <div class="mt-1 text-xs text-slate-400">手机号：{{ user.phone || '未填写' }} · 下放权限：{{ scopeLabelText(user.admin_scopes) }}</div>
              </div>
              <div class="w-full rounded-[28px] bg-slate-50 px-4 py-4">
                <div class="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                  <div class="space-y-2">
                    <div class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">配额</div>
                    <div class="flex gap-2">
                      <input v-model="ensureUserDraft(user).quotaMb" type="number" min="1" class="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none" placeholder="MB">
                      <button class="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold" @click="saveQuota(user)">保存</button>
                    </div>
                  </div>
                  <div class="space-y-2">
                    <div class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">重置密码</div>
                    <div class="flex gap-2">
                      <input v-model="ensureUserDraft(user).password" type="password" class="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none" placeholder="新密码">
                      <button class="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold" @click="resetPassword(user)">重置</button>
                    </div>
                  </div>
                  <div class="space-y-2">
                    <div class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">资产转移</div>
                    <div class="flex gap-2">
                      <input v-model="ensureUserDraft(user).transferTo" class="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none" placeholder="接收账号">
                      <button class="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold" @click="transferAssets(user)">转移</button>
                    </div>
                  </div>
                  <div class="space-y-2">
                    <div class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">账号状态</div>
                    <div class="flex gap-2">
                      <button class="rounded-2xl px-3 py-2 text-sm font-semibold" :class="user.is_disabled ? 'bg-emerald-600 text-white' : 'border border-slate-200 bg-white text-slate-700'" @click="toggleDisabled(user)">
                        {{ user.is_disabled ? '恢复账号' : '冻结账号' }}
                      </button>
                      <button class="rounded-2xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600" @click="deleteUser(user)">删除用户</button>
                    </div>
                  </div>
                </div>
                <div v-if="state.isSuperAdmin && !user.is_super_admin" class="mt-4 rounded-[24px] border border-dashed border-slate-200 bg-white px-4 py-4">
                  <div class="grid gap-3 lg:grid-cols-[14rem_1fr_auto]">
                    <select v-model="ensureUserDraft(user).role" class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none">
                      <option value="user">普通用户</option>
                      <option value="admin">子管理员</option>
                    </select>
                    <div v-if="ensureUserDraft(user).role === 'admin'" class="flex flex-wrap gap-3 text-sm text-slate-600">
                      <label v-for="scope in scopeOptions" :key="scope.value" class="inline-flex items-center gap-2">
                        <input type="checkbox" :checked="ensureUserDraft(user).adminScopes.includes(scope.value)" @change="toggleUserScope(user.username, scope.value, $event.target.checked)">
                        <span>{{ scope.label }}</span>
                      </label>
                    </div>
                    <div v-else class="text-sm text-slate-400">普通用户不持有下放权限。</div>
                    <button class="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white" @click="saveRole(user)">保存角色</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="!state.adminUsers.length" class="px-4 py-12 text-center text-sm text-slate-500">
            暂无用户数据。
          </div>
        </section>
      </section>

      <section v-if="activeSection === 'repos' && hasScope('audit_logs')" class="overflow-hidden rounded-[32px] border border-slate-200 bg-white">
        <div class="border-b border-slate-100 px-5 py-4 text-lg font-semibold text-slate-900">仓库管理</div>
        <div class="divide-y divide-slate-100">
          <div v-for="repo in state.adminRepos" :key="repo.id" class="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
            <div>
              <div class="font-semibold text-slate-900">{{ repo.name }}</div>
              <div class="mt-1 text-sm text-slate-500">{{ repo.owner_username }} · {{ repo.visibility === 'public' ? '公开' : '私有' }} · {{ repo.file_count }} 个文件 · {{ repo.member_count }} 名成员</div>
              <div class="mt-1 text-xs text-slate-400">占用 {{ formatSize(repo.storage) }} · {{ repo.updated_at || '未知时间' }}</div>
            </div>
            <div class="flex flex-wrap gap-2">
              <button class="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold" @click="openRepo(repo.id)">打开仓库</button>
              <button v-if="hasScope('storage_cleanup')" class="rounded-2xl bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-600" @click="deleteRepo(repo)">删除仓库</button>
            </div>
          </div>
        </div>
        <div v-if="!state.adminRepos.length" class="px-4 py-12 text-center text-sm text-slate-500">
          暂无仓库数据。
        </div>
      </section>

      <section v-if="activeSection === 'shares' && hasScope('share_governance')" class="overflow-hidden rounded-[32px] border border-slate-200 bg-white">
        <div class="border-b border-slate-100 px-5 py-4 text-lg font-semibold text-slate-900">全局公开分享链接</div>
        <div class="divide-y divide-slate-100">
          <div v-for="share in state.adminShares" :key="share.code" class="px-5 py-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="font-semibold text-slate-900">{{ share.code }} · {{ share.username }}/{{ share.filename }}</div>
                <div class="mt-1 text-sm text-slate-500">{{ share.access_level === 'public' ? '公开' : share.access_level }} · 创建于 {{ share.created_at || '未知时间' }}</div>
                <div class="mt-1 text-xs text-slate-400">{{ shareStatusText(share) }} · {{ share.has_password ? '已加密码' : '未设置密码' }}</div>
              </div>
              <div class="grid gap-2 md:grid-cols-[12rem_14rem_auto_auto]">
                <input v-model="ensureShareDraft(share).password" type="password" class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none" placeholder="新密码，留空不改">
                <input v-model="ensureShareDraft(share).expiresAt" class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none" placeholder="YYYY-MM-DD HH:mm:ss">
                <button class="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold" @click="saveSharePolicy(share)">保存策略</button>
                <button class="rounded-2xl bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-600" @click="revokeShare(share)">撤销分享</button>
              </div>
            </div>
          </div>
        </div>
        <div v-if="!state.adminShares.length" class="px-4 py-12 text-center text-sm text-slate-500">
          暂无公开分享链接。
        </div>
      </section>

      <section v-if="activeSection === 'recycle' && hasScope('storage_cleanup')" class="overflow-hidden rounded-[32px] border border-slate-200 bg-white">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <div class="text-lg font-semibold text-slate-900">全局回收站</div>
            <div class="mt-1 text-sm text-slate-500">这里保存被删除但尚未彻底清理的文件，清空后会释放物理磁盘空间。</div>
          </div>
          <button class="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white" @click="purgeRecycleBin">清空回收站</button>
        </div>
        <div class="divide-y divide-slate-100">
          <div v-for="item in state.recycleBinItems" :key="item.id" class="flex flex-wrap items-center justify-between gap-4 px-5 py-4 text-sm text-slate-600">
            <div>
              <div class="font-semibold text-slate-900">{{ item.original_name }}</div>
              <div class="mt-1">{{ item.source_type }} · 所属 {{ item.owner_username }} · 删除者 {{ item.deleted_by || '未知' }}</div>
            </div>
            <div class="text-right text-xs text-slate-400">{{ formatSize(item.size_bytes || 0) }} · {{ item.deleted_at || '未知时间' }}</div>
          </div>
        </div>
        <div v-if="!state.recycleBinItems.length" class="px-4 py-12 text-center text-sm text-slate-500">
          当前回收站为空。
        </div>
      </section>

      <section v-if="activeSection === 'logs' && hasScope('audit_logs')" class="overflow-hidden rounded-[32px] border border-slate-200 bg-white">
        <div class="border-b border-slate-100 px-5 py-4 text-lg font-semibold text-slate-900">操作日志审计</div>
        <div class="divide-y divide-slate-100">
          <div v-for="log in state.auditLogs" :key="log.id" class="flex flex-wrap items-start justify-between gap-4 px-5 py-4 text-sm">
            <div class="min-w-0 flex-1">
              <div class="font-semibold text-slate-900">{{ log.action }} · {{ log.outcome === 'success' ? '成功' : '拒绝' }}</div>
              <div class="mt-1 text-slate-500">{{ log.actor_username || 'anonymous' }} / {{ log.actor_role || 'user' }} / {{ log.ip_address || 'unknown' }}</div>
              <div class="mt-1 text-xs text-slate-400">{{ formatLogTarget(log) }} · {{ log.detail || '无附加说明' }}</div>
            </div>
            <div class="text-xs text-slate-400">{{ log.created_at || '未知时间' }}</div>
          </div>
        </div>
        <div v-if="!state.auditLogs.length" class="px-4 py-12 text-center text-sm text-slate-500">
          暂无审计日志。
        </div>
      </section>
    </div>
  `,
};
