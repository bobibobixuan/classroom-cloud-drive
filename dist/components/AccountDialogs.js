import { computed, ref, watch } from '../deps.js';
import { actions, state } from '../store.js';
import {
  closeDeleteAccount,
  closeRename,
  closeSecurity,
  confirmAction,
  openDeleteAccount,
  uiState,
  showToast,
} from '../ui.js';
import { splitAccountDisplay } from '../utils.js';

export default {
  name: 'AccountDialogs',
  setup() {
    const accountDisplay = computed(() => splitAccountDisplay(state.user, state.realName));
    const nextUsername = ref(accountDisplay.value.primary || state.user || '');
    const deletePassword = ref('');

    watch(
      () => uiState.renameOpen,
      (open) => {
        if (open) {
          nextUsername.value = accountDisplay.value.primary || state.user || '';
        }
      },
    );

    watch(
      () => uiState.deleteAccountOpen,
      (open) => {
        if (open) {
          deletePassword.value = '';
        }
      },
    );

    const submitRename = async () => {
      if (!nextUsername.value.trim()) {
        showToast('请输入新的用户名', 'warning');
        return;
      }
      try {
        await actions.renameAccount(nextUsername.value);
        closeRename();
        showToast('用户名修改成功', 'success');
      } catch (error) {
        showToast(error.message || '修改用户名失败', 'error');
      }
    };

    const submitDelete = async () => {
      if (!deletePassword.value) {
        showToast('请输入密码', 'warning');
        return;
      }
      if (!(await confirmAction({ title: '注销账号', message: '注销后数据无法恢复，确定继续吗？', confirmText: '确认注销' }))) {
        return;
      }
      try {
        await actions.deleteAccount(deletePassword.value);
      } catch (error) {
        showToast(error.message || '注销失败', 'error');
      }
    };

    return {
      uiState,
      accountDisplay,
      nextUsername,
      deletePassword,
      closeRename,
      closeSecurity,
      openDeleteAccount,
      closeDeleteAccount,
      submitRename,
      submitDelete,
      logout: actions.logout,
    };
  },
  template: `
    <div>
      <div v-if="uiState.renameOpen" class="fixed inset-0 z-[125] flex items-center justify-center bg-slate-950/45 px-4" @click.self="closeRename()">
        <div class="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl">
          <h3 class="text-xl font-semibold text-slate-900">修改用户名</h3>
          <p class="mt-3 text-sm leading-7 text-slate-500">修改后，你的云盘归属、聊天昵称、仓库归属和协作身份都会一起更新。</p>
          <div v-if="accountDisplay.secondary" class="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
            当前实名后缀会保留：<span class="font-medium text-slate-700">{{ accountDisplay.secondary }}</span>。这里只需要修改昵称部分。
          </div>
          <input v-model="nextUsername" class="mt-4 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none" :placeholder="accountDisplay.secondary ? '请输入新的昵称' : '请输入新的用户名'">
          <div class="mt-6 flex justify-end gap-3">
            <button class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold" @click="closeRename()">取消</button>
            <button class="rounded-2xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white" @click="submitRename">确认修改</button>
          </div>
        </div>
      </div>

      <div v-if="uiState.securityOpen" class="fixed inset-0 z-[125] flex items-center justify-center bg-slate-950/45 px-4" @click.self="closeSecurity()">
        <div class="w-full max-w-2xl rounded-[32px] border border-slate-200 bg-white p-6 shadow-2xl">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h3 class="text-2xl font-semibold text-slate-900">账号安全</h3>
              <p class="mt-2 text-sm leading-7 text-slate-500">危险操作集中放在这里，不再和高频导航挤在一起。</p>
            </div>
            <button class="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold" @click="closeSecurity()">关闭</button>
          </div>
          <div class="mt-6 grid gap-4 lg:grid-cols-2">
            <section class="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <h4 class="text-lg font-semibold text-slate-900">日常操作</h4>
              <p class="mt-2 text-sm leading-7 text-slate-500">退出登录不会删除任何数据，只会清空当前浏览器会话。</p>
              <button class="mt-5 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold" @click="logout()">立即退出登录</button>
            </section>
            <section class="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <h4 class="text-lg font-semibold text-slate-900">管理员交接提醒</h4>
              <p class="mt-2 text-sm leading-7 text-slate-500">如果你是最后一名管理员，后端会阻止你直接注销，必须先把管理员权限交接出去。</p>
            </section>
          </div>
          <section class="mt-5 rounded-[28px] border border-rose-200 bg-rose-50 p-5">
            <h4 class="text-lg font-semibold text-rose-700">永久注销账号</h4>
            <p class="mt-2 text-sm leading-7 text-rose-600">这是彻底销毁数据的操作，包含云盘文件、聊天身份、你拥有的仓库以及仓库成员关系。</p>
            <button class="mt-5 rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white" @click="openDeleteAccount()">进入注销流程</button>
          </section>
        </div>
      </div>

      <div v-if="uiState.deleteAccountOpen" class="fixed inset-0 z-[126] flex items-center justify-center bg-slate-950/55 px-4" @click.self="closeDeleteAccount()">
        <div class="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-6 shadow-2xl">
          <h3 class="text-xl font-semibold text-rose-700">确认注销账号</h3>
          <p class="mt-3 text-sm leading-7 text-slate-500">请再次输入密码。此操作不可恢复，并且你拥有的仓库会被一并删除。</p>
          <input v-model="deletePassword" class="mt-4 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none" type="password" placeholder="请输入密码确认注销">
          <div class="mt-6 flex justify-end gap-3">
            <button class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold" @click="closeDeleteAccount()">取消</button>
            <button class="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white" @click="submitDelete">确认注销</button>
          </div>
        </div>
      </div>
    </div>
  `,
};
