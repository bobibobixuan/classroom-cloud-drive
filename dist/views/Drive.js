import { computed, onMounted, ref } from '../deps.js';
import { actions, isBusy, state } from '../store.js';
import { confirmAction, showToast, toggleChat } from '../ui.js';
import { formatSize, stopEvent } from '../utils.js';

const homeAnnouncementLines = [
  '欢迎使用课堂云盘与项目仓库。',
  '个人文件请先上传到云盘，再根据需要设置聊天分享权限。',
  '进入项目仓库后，如需共同维护资料，请先提交加入申请并等待审核。',
  '审批结果、协作变更和公告更新会显示在右上角通知中，请及时查看。',
];

const buildNoticeVersion = (content) => {
  let hash = 0;
  for (const char of String(content || '')) {
    hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
};

const homeAnnouncementVersion = buildNoticeVersion(homeAnnouncementLines.join('\n'));

const getHomeAnnouncementSeenKey = (username) => `ccd-home-announcement-seen:${username || 'guest'}:${homeAnnouncementVersion}`;

export default {
  name: 'DriveView',
  setup() {
    const batchShareScope = ref('public');
    const fileInput = ref(null);
    const dragActive = ref(false);
    const homeAnnouncementOpen = ref(false);

    const selectedCount = computed(() => state.selectedDriveFiles.length);
    const allSelected = computed({
      get() {
        return state.driveFiles.length > 0 && state.selectedDriveFiles.length === state.driveFiles.length;
      },
      set(value) {
        actions.setAllDriveSelection(value);
      },
    });

    const load = async () => {
      try {
        await actions.loadDrive();
      } catch (error) {
        showToast(error.message || '加载云盘失败', 'error');
      }
    };

    const getViewerName = () => state.user || window.localStorage.getItem('user') || 'guest';

    const maybeOpenHomeAnnouncement = () => {
      const storageKey = getHomeAnnouncementSeenKey(getViewerName());
      if (window.localStorage.getItem(storageKey) !== '1') {
        homeAnnouncementOpen.value = true;
      }
    };

    onMounted(async () => {
      await load();
      maybeOpenHomeAnnouncement();
    });

    const closeHomeAnnouncement = () => {
      window.localStorage.setItem(getHomeAnnouncementSeenKey(getViewerName()), '1');
      homeAnnouncementOpen.value = false;
    };

    const openPicker = () => fileInput.value?.click();

    const uploadFile = async (file) => {
      if (!file) return;
      try {
        await actions.uploadDriveFile(file);
      } catch (error) {
        showToast(error.message || '上传失败', 'error');
      }
    };

    const onInputChange = async (event) => {
      await uploadFile(event.target.files?.[0]);
      event.target.value = '';
    };

    const onDrop = async (event) => {
      stopEvent(event);
      dragActive.value = false;
      await uploadFile(event.dataTransfer?.files?.[0]);
    };

    const applyBatchShare = async () => {
      if (!state.selectedDriveFiles.length) {
        showToast('请先选择文件', 'warning');
        return;
      }
      try {
        await actions.applyBatchShareScope(state.selectedDriveFiles, batchShareScope.value);
        showToast('批量分享权限已更新', 'success');
      } catch (error) {
        showToast(error.message || '批量更新分享权限失败', 'error');
      }
    };

    const shareBatchToChat = async () => {
      if (!state.selectedDriveFiles.length) {
        showToast('请先选择文件', 'warning');
        return;
      }
      try {
        await actions.batchShareToChat(state.selectedDriveFiles);
        toggleChat(true);
      } catch (error) {
        showToast(error.message || '批量分享到聊天失败', 'error');
      }
    };

    const deleteBatch = async () => {
      if (!state.selectedDriveFiles.length) {
        showToast('请先选择文件', 'warning');
        return;
      }
      if (!(await confirmAction({ title: '批量删除文件', message: `确定批量删除 ${state.selectedDriveFiles.length} 个文件吗？`, confirmText: '确认删除' }))) {
        return;
      }
      try {
        await actions.batchDeleteDriveFiles(state.selectedDriveFiles);
        showToast('批量删除完成', 'success');
      } catch (error) {
        showToast(error.message || '批量删除失败', 'error');
      }
    };

    const updateShare = async (filename, value) => {
      try {
        await actions.updateDriveShareScope(filename, value);
      } catch (error) {
        showToast(error.message || '更新分享权限失败', 'error');
      }
    };

    const downloadFile = async (filename) => {
      try {
        await actions.downloadDriveFile(filename);
      } catch (error) {
        showToast(error.message || '下载失败', 'error');
      }
    };

    const deleteFile = async (filename) => {
      if (!(await confirmAction({ title: '删除云盘文件', message: `确定删除 ${filename} 吗？`, confirmText: '删除文件' }))) {
        return;
      }
      try {
        await actions.deleteDriveFile(filename);
        showToast(`已删除 ${filename}`, 'success');
      } catch (error) {
        showToast(error.message || '删除失败', 'error');
      }
    };

    const shareFile = async (filename) => {
      try {
        await actions.shareDriveFileToChat(filename);
        toggleChat(true);
      } catch (error) {
        showToast(error.message || '分享失败', 'error');
      }
    };

    return {
      state,
      batchShareScope,
      fileInput,
      dragActive,
      homeAnnouncementOpen,
      homeAnnouncementLines,
      selectedCount,
      allSelected,
      isBusy,
      formatSize,
      closeHomeAnnouncement,
      openPicker,
      onInputChange,
      onDrop,
      applyBatchShare,
      shareBatchToChat,
      deleteBatch,
      updateShare,
      downloadFile,
      deleteFile,
      shareFile,
      actions,
    };
  },
  template: `
    <div class="space-y-6">
      <section class="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div
          class="rounded-[32px] border-2 border-dashed px-6 py-7 transition"
          :class="dragActive ? 'border-sky-500 bg-sky-50' : 'border-sky-200 bg-gradient-to-br from-sky-50 to-emerald-50'"
          @click="openPicker"
          @dragenter.prevent="dragActive = true"
          @dragover.prevent="dragActive = true"
          @dragleave.prevent="dragActive = false"
          @drop="onDrop"
        >
          <input ref="fileInput" class="hidden" type="file" @change="onInputChange">
          <div class="text-lg font-semibold text-slate-900">上传到个人云盘</div>
          <div class="mt-5 inline-flex rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
            选择文件或直接拖拽到这里
          </div>
        </div>

        <div class="rounded-[32px] border border-slate-200 bg-slate-50 px-6 py-6">
          <div class="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">Storage</div>
          <div class="mt-3 text-3xl font-bold text-slate-900">{{ (state.driveFiles.length || 0) }} 个文件</div>
          <div v-if="state.driveUpload.visible" class="mt-5 rounded-[24px] border border-slate-200 bg-white px-4 py-4">
            <div class="text-sm font-semibold text-slate-800">正在上传：{{ state.driveUpload.fileName }}</div>
            <div class="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
              <div class="h-full rounded-full bg-sky-600 transition-all" :style="{ width: state.driveUpload.percent + '%' }"></div>
            </div>
            <div class="mt-3 text-sm text-slate-500">{{ state.driveUpload.statusText }}</div>
          </div>
        </div>
      </section>

      <section class="rounded-[32px] border border-slate-200 bg-slate-50 px-5 py-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3 text-sm text-slate-600">
            <label class="inline-flex items-center gap-2">
              <input v-model="allSelected" type="checkbox" class="rounded border-slate-300">
              全选
            </label>
            <span>已选择 {{ selectedCount }} 个文件</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <select v-model="batchShareScope" class="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="private">私密</option>
              <option value="public">公开</option>
            </select>
            <button class="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold" @click="applyBatchShare">应用权限</button>
            <button class="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold" @click="shareBatchToChat">批量分享到聊天</button>
            <button class="rounded-2xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white" :disabled="isBusy('drive-batch-delete')" @click="deleteBatch">
              {{ isBusy('drive-batch-delete') ? '删除中' : '批量删除' }}
            </button>
          </div>
        </div>
      </section>

      <section class="overflow-hidden rounded-[32px] border border-slate-200 bg-white">
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-slate-200 text-sm">
            <thead class="bg-slate-50 text-left text-slate-500">
              <tr>
                <th class="px-4 py-3 font-semibold"></th>
                <th class="px-4 py-3 font-semibold">文件名</th>
                <th class="px-4 py-3 font-semibold">大小</th>
                <th class="px-4 py-3 font-semibold">聊天分享权限</th>
                <th class="px-4 py-3 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody v-if="state.driveFiles.length" class="divide-y divide-slate-100">
              <tr v-for="file in state.driveFiles" :key="file.name" class="hover:bg-slate-50/80">
                <td class="px-4 py-3">
                  <input
                    type="checkbox"
                    class="rounded border-slate-300"
                    :checked="state.selectedDriveFiles.includes(file.name)"
                    @change="actions.toggleDriveSelection(file.name, $event.target.checked)"
                  >
                </td>
                <td class="px-4 py-3 font-medium text-slate-900">{{ file.name }}</td>
                <td class="px-4 py-3 text-slate-500">{{ formatSize(file.size) }}</td>
                <td class="px-4 py-3">
                  <select class="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm" :value="file.share_scope" @change="updateShare(file.name, $event.target.value)">
                    <option value="private">私密，不可发聊天</option>
                    <option value="public">公开分享码</option>
                  </select>
                </td>
                <td class="px-4 py-3">
                  <div class="flex flex-wrap gap-2">
                    <button class="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold" @click="downloadFile(file.name)">下载</button>
                    <button class="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold" :disabled="file.share_scope === 'private'" @click="shareFile(file.name)">分享到聊天</button>
                    <button class="rounded-2xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600" @click="deleteFile(file.name)">删除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="!state.driveFiles.length" class="px-4 py-12 text-center text-sm text-slate-500">
          你的个人云盘还没有文件。上传后可以决定是否允许通过聊天提取码分享。
        </div>
      </section>

      <div v-if="homeAnnouncementOpen" class="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 px-4" @click.self="closeHomeAnnouncement">
        <div class="w-full max-w-2xl rounded-[32px] border border-slate-200 bg-white p-6 shadow-2xl md:p-7">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-sm font-medium uppercase tracking-[0.24em] text-sky-600">Workspace Notice</div>
              <h3 class="mt-2 text-2xl font-bold text-slate-900">系统公告</h3>
              <p class="mt-2 text-sm text-slate-500">首次进入主页时展示一次</p>
            </div>
            <button class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600" @click="closeHomeAnnouncement">关闭</button>
          </div>

          <div class="mt-5 rounded-[28px] border border-slate-200 bg-slate-50 px-5 py-5">
            <ol class="space-y-3 text-sm leading-7 text-slate-700">
              <li v-for="(line, index) in homeAnnouncementLines" :key="line">
                {{ index + 1 }}. {{ line }}
              </li>
            </ol>
          </div>

          <div class="mt-5 flex justify-end">
            <button class="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white" @click="closeHomeAnnouncement">我知道了</button>
          </div>
        </div>
      </div>
    </div>
  `,
};
