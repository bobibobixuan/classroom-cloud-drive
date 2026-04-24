import { computed, onMounted, ref, watch } from '../deps.js';
import { actions, state } from '../store.js';
import { confirmAction, showToast } from '../ui.js';
import { formatSize } from '../utils.js';
import { useRoute, useRouter } from '../deps.js';

const standardRepoNotice = [
  '欢迎进入本仓库。',
  '请先查看文件区中的现有资料，再决定是否上传新版本。',
  '如需参与维护，请先提交加入申请，待拥有者或管理员审核通过后再进行上传、删除等操作。',
  '审批结果、协作变更和公告更新会出现在右上角通知中，请及时查看。',
  '上传前请确认命名规范与版本是否重复，避免覆盖有效资料。',
].join('\n');

const buildNoticeVersion = (content) => {
  let hash = 0;
  for (const char of String(content || '')) {
    hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
};

const getRepoNoticeSeenKey = (username, repoId, noticeBody) => {
  return `ccd-repo-notice-seen:${username || 'guest'}:${repoId}:${buildNoticeVersion(noticeBody)}`;
};

export default {
  name: 'RepoDetailView',
  setup() {
    const route = useRoute();
    const router = useRouter();
    const visibility = ref('private');
    const newMemberName = ref('');
    const joinMessage = ref('');
    const announcementDraft = ref('');
    const fileInput = ref(null);
    const dragActive = ref(false);
    const entryNoticeOpen = ref(false);
    const repoLogModalOpen = ref(false);

    const repo = computed(() => state.activeRepo?.repo || null);
    const files = computed(() => state.activeRepo?.files || []);
    const members = computed(() => state.activeRepo?.members || []);
    const joinRequests = computed(() => state.activeRepo?.join_requests || []);
    const myJoinRequest = computed(() => state.activeRepo?.my_join_request || null);
    const repoLogs = computed(() => state.activeRepo?.repo_logs || []);
    const canManage = computed(() => !!repo.value?.can_manage);
    const canWrite = computed(() => !!repo.value?.can_write);
    const canRequestJoin = computed(() => !!state.user && !!repo.value && !canManage.value && !canWrite.value && !repo.value?.my_role);
    const canSubmitJoinRequest = computed(() => canRequestJoin.value && myJoinRequest.value?.status !== 'pending');
    const canCancelJoinRequest = computed(() => myJoinRequest.value?.status === 'pending');
    const canLeaveRepo = computed(() => repo.value?.my_role === 'collaborator');
    const fileColumnName = computed(() => files.value.some((file) => String(file.path || '').includes('/')) ? '路径' : '文件名');
    const memberSummary = computed(() => {
      const ownerCount = members.value.filter((member) => member.role === 'owner').length;
      return {
        total: members.value.length,
        ownerCount,
        collaboratorCount: Math.max(0, members.value.length - ownerCount),
      };
    });
    const entryNoticeTitle = computed(() => repo.value?.announcement ? '仓库公告' : '入库须知');
    const entryNoticeBody = computed(() => {
      const content = (repo.value?.announcement || '').trim();
      return content || standardRepoNotice;
    });
    const latestRepoLog = computed(() => repoLogs.value[0] || null);

    const getViewerName = () => state.user || window.localStorage.getItem('user') || 'guest';

    const getRepoNoticeBody = (repoRecord) => {
      const content = String(repoRecord?.announcement || '').trim();
      return content || standardRepoNotice;
    };

    const maybeOpenEntryNotice = (repoRecord) => {
      if (!repoRecord?.id) return;
      const seenKey = getRepoNoticeSeenKey(getViewerName(), repoRecord.id, getRepoNoticeBody(repoRecord));
      const hasSeen = window.localStorage.getItem(seenKey) === '1';
      entryNoticeOpen.value = !hasSeen;
    };

    const load = async () => {
      try {
        const data = await actions.loadRepoDetail(route.params.id);
        visibility.value = data.repo.visibility;
        announcementDraft.value = data.repo.announcement || '';
        maybeOpenEntryNotice(data.repo);
      } catch (error) {
        showToast(error.message || '加载仓库失败', 'error');
        router.push('/repos/mine');
      }
    };

    onMounted(load);
    watch(() => route.params.id, load);

    const saveVisibility = async (nextValue) => {
      try {
        await actions.updateRepoVisibility(route.params.id, nextValue);
        visibility.value = nextValue;
        showToast('仓库可见性已更新', 'success');
      } catch (error) {
        showToast(error.message || '更新仓库可见性失败', 'error');
      }
    };

    const submitMember = async () => {
      if (!newMemberName.value.trim()) {
        showToast('请输入协作者用户名', 'warning');
        return;
      }
      try {
        await actions.addRepoMember(route.params.id, newMemberName.value);
        newMemberName.value = '';
        showToast('已添加协作者', 'success');
      } catch (error) {
        showToast(error.message || '添加协作者失败', 'error');
      }
    };

    const removeMember = async (username) => {
      if (!(await confirmAction({ title: '移除协作者', message: `确定将 ${username} 移出仓库吗？`, confirmText: '移除成员' }))) {
        return;
      }
      try {
        await actions.removeRepoMember(route.params.id, username);
        showToast(`已移除成员 ${username}`, 'success');
      } catch (error) {
        showToast(error.message || '移除成员失败', 'error');
      }
    };

    const submitJoinRequest = async () => {
      try {
        await actions.requestRepoJoin(route.params.id, joinMessage.value);
        joinMessage.value = '';
        showToast('已提交加入维护申请', 'success');
      } catch (error) {
        showToast(error.message || '提交申请失败', 'error');
      }
    };

    const cancelJoinRequest = async () => {
      if (!(await confirmAction({ title: '取消申请', message: '确定撤回当前的加入维护申请吗？', confirmText: '撤回申请' }))) {
        return;
      }
      try {
        await actions.cancelRepoJoinRequest(route.params.id);
        showToast('已撤回加入维护申请', 'success');
      } catch (error) {
        showToast(error.message || '撤回申请失败', 'error');
      }
    };

    const leaveRepo = async () => {
      if (!(await confirmAction({ title: '退出维护', message: '确定退出当前仓库的维护吗？退出后将失去写入权限。', confirmText: '退出维护' }))) {
        return;
      }
      try {
        await actions.leaveRepo(route.params.id);
        showToast('你已退出该仓库的维护', 'success');
      } catch (error) {
        showToast(error.message || '退出维护失败', 'error');
      }
    };

    const reviewJoinRequest = async (username, action) => {
      const label = action === 'approve' ? '通过' : '拒绝';
      if (!(await confirmAction({ title: `${label}申请`, message: `确定${label} ${username} 的加入维护申请吗？`, confirmText: label }))) {
        return;
      }
      try {
        await actions.reviewRepoJoinRequest(route.params.id, username, action);
        showToast(action === 'approve' ? '已通过申请' : '已拒绝申请', 'success');
      } catch (error) {
        showToast(error.message || '处理申请失败', 'error');
      }
    };

    const joinRequestStatusLabel = (request) => {
      if (!request) return '';
      if (request.status === 'approved') return '已通过';
      if (request.status === 'rejected') return '已拒绝';
      if (request.status === 'cancelled') return '已取消';
      return '待审核';
    };

    const repoLogActionLabel = (action) => {
      const labels = {
        'repo.created': '创建仓库',
        'repo.visibility': '调整仓库可见性',
        'repo.announcement': '更新仓库公告',
        'repo.member.add': '添加协作者',
        'repo.member.remove': '移除协作者',
        'repo.member.leave': '主动退出维护',
        'repo.join_request.pending': '提交加入申请',
        'repo.join_request.cancelled': '撤回加入申请',
        'repo.join_request.approved': '通过加入申请',
        'repo.join_request.rejected': '拒绝加入申请',
        'repo.file.upload': '上传文件',
        'repo.file.delete': '删除文件',
      };
      return labels[action] || action || '仓库操作';
    };

    const saveAnnouncement = async () => {
      try {
        await actions.updateRepoAnnouncement(route.params.id, announcementDraft.value);
        showToast('仓库公告已更新', 'success');
      } catch (error) {
        showToast(error.message || '更新仓库公告失败', 'error');
      }
    };

    const useStandardAnnouncement = () => {
      announcementDraft.value = standardRepoNotice;
      showToast('已填入标准公告，可继续修改后保存', 'success');
    };

    const closeEntryNotice = () => {
      if (repo.value?.id) {
        window.localStorage.setItem(getRepoNoticeSeenKey(getViewerName(), repo.value.id, entryNoticeBody.value), '1');
      }
      entryNoticeOpen.value = false;
    };

    const openRepoLogs = () => {
      repoLogModalOpen.value = true;
    };

    const closeRepoLogs = () => {
      repoLogModalOpen.value = false;
    };

    const openPicker = () => fileInput.value?.click();

    const uploadFiles = async (fileList) => {
      if (!fileList?.length) return;
      try {
        await actions.uploadRepoFiles(route.params.id, fileList);
      } catch (error) {
        showToast(error.message || '上传仓库文件失败', 'error');
      }
    };

    const onInputChange = async (event) => {
      await uploadFiles(event.target.files);
      event.target.value = '';
    };

    const onDrop = async (event) => {
      event.preventDefault();
      dragActive.value = false;
      await uploadFiles(event.dataTransfer?.files);
    };

    const downloadFile = async (path) => {
      try {
        await actions.downloadRepoFile(route.params.id, path);
      } catch (error) {
        showToast(error.message || '下载仓库文件失败', 'error');
      }
    };

    const deleteFile = async (path) => {
      if (!(await confirmAction({ title: '删除仓库文件', message: `确定从仓库删除 ${path} 吗？`, confirmText: '删除文件' }))) {
        return;
      }
      try {
        await actions.deleteRepoFile(route.params.id, path);
        showToast(`已删除仓库文件 ${path}`, 'success');
      } catch (error) {
        showToast(error.message || '删除仓库文件失败', 'error');
      }
    };

    return {
      repo,
      files,
      members,
      joinRequests,
      myJoinRequest,
      repoLogs,
      visibility,
      newMemberName,
      joinMessage,
      announcementDraft,
      fileInput,
      dragActive,
      canManage,
      canWrite,
      canRequestJoin,
      canSubmitJoinRequest,
      canCancelJoinRequest,
      canLeaveRepo,
      fileColumnName,
      memberSummary,
      formatSize,
      entryNoticeOpen,
      entryNoticeTitle,
      entryNoticeBody,
      repoLogModalOpen,
      latestRepoLog,
      router,
      saveVisibility,
      saveAnnouncement,
      useStandardAnnouncement,
      submitMember,
      removeMember,
      submitJoinRequest,
      cancelJoinRequest,
      leaveRepo,
      reviewJoinRequest,
      joinRequestStatusLabel,
      repoLogActionLabel,
      openPicker,
      onInputChange,
      onDrop,
      downloadFile,
      deleteFile,
      closeEntryNotice,
      openRepoLogs,
      closeRepoLogs,
    };
  },
  template: `
    <div v-if="repo" class="space-y-6">
      <section class="rounded-[32px] border border-slate-200 bg-slate-50 px-6 py-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">Repository</div>
            <h2 class="mt-2 text-3xl font-bold text-slate-900">{{ repo.name }}</h2>
            <p class="mt-2 max-w-3xl text-sm leading-7 text-slate-500">{{ repo.description || '暂无说明' }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <span class="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">{{ repo.owner_username }}</span>
            <span class="rounded-full px-3 py-1 text-xs font-semibold" :class="repo.visibility === 'public' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'">
              {{ repo.visibility === 'public' ? '公开仓库' : '私有仓库' }}
            </span>
            <span class="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">{{ repo.can_write ? '可维护' : '只读' }}</span>
          </div>
        </div>

        <div class="mt-5 rounded-[28px] border border-amber-200 bg-amber-50 px-5 py-4">
          <div class="text-sm font-semibold text-amber-800">仓库公告</div>
          <p v-if="repo.announcement" class="mt-2 whitespace-pre-wrap text-sm leading-7 text-amber-900">{{ repo.announcement }}</p>
          <p v-else class="mt-2 text-sm text-amber-700">当前还没有公告。</p>
        </div>
      </section>

      <section class="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.95fr)]">
        <div class="space-y-6">
          <section class="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
            <div class="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
              <div>
                <h3 class="text-xl font-semibold text-slate-900">文件区</h3>
                <p class="mt-2 text-sm leading-7 text-slate-500">这里展示当前仓库的全部资料，可直接下载、上传或删除文件。</p>
              </div>
              <div class="grid gap-2 text-sm text-slate-500 sm:grid-cols-3">
                <div class="rounded-3xl bg-slate-50 px-4 py-3">文件 {{ repo.file_count }}</div>
                <div class="rounded-3xl bg-slate-50 px-4 py-3">成员 {{ memberSummary.total }}</div>
                <div class="rounded-3xl bg-slate-50 px-4 py-3">{{ repo.visibility === 'public' ? '公开协作' : '私有协作' }}</div>
              </div>
            </div>

            <div v-if="canWrite" class="border-b border-slate-100 px-6 py-5">
              <div class="rounded-[28px] border-2 border-dashed px-6 py-6 transition" :class="dragActive ? 'border-sky-500 bg-sky-50' : 'border-sky-200 bg-gradient-to-br from-sky-50 to-emerald-50'" @click="openPicker" @dragenter.prevent="dragActive = true" @dragover.prevent="dragActive = true" @dragleave.prevent="dragActive = false" @drop="onDrop">
                <input ref="fileInput" class="hidden" type="file" multiple @change="onInputChange">
                <div class="text-lg font-semibold text-slate-900">上传文件到仓库</div>
                <div class="mt-2 text-sm text-slate-600">支持点击选择或直接拖拽文件到此区域。</div>
              </div>
            </div>

            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-slate-200 text-sm">
                <thead class="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th class="px-4 py-3 font-semibold">{{ fileColumnName }}</th>
                    <th class="px-4 py-3 font-semibold">大小</th>
                    <th class="px-4 py-3 font-semibold">最近维护者</th>
                    <th class="px-4 py-3 font-semibold">更新时间</th>
                    <th class="px-4 py-3 font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody v-if="files.length" class="divide-y divide-slate-100">
                  <tr v-for="file in files" :key="file.path" class="hover:bg-slate-50/80">
                    <td class="px-4 py-3 font-medium text-slate-900">{{ file.path }}</td>
                    <td class="px-4 py-3 text-slate-500">{{ formatSize(file.size) }}</td>
                    <td class="px-4 py-3 text-slate-500">{{ file.updated_by || '未知' }}</td>
                    <td class="px-4 py-3 text-slate-500">{{ file.updated_at || '未知' }}</td>
                    <td class="px-4 py-3">
                      <div class="flex flex-wrap gap-2">
                        <button class="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold" @click="downloadFile(file.path)">下载</button>
                        <button v-if="canWrite" class="rounded-2xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600" @click="deleteFile(file.path)">删除</button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="!files.length" class="px-4 py-12 text-center text-sm text-slate-500">
              这个仓库还没有文件。
            </div>
          </section>

          <section v-if="canManage" class="rounded-[32px] border border-slate-200 bg-white px-6 py-6 shadow-sm">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 class="text-xl font-semibold text-slate-900">仓库设置</h3>
                <p class="mt-2 text-sm leading-7 text-slate-500">可在这里维护仓库公开范围，并编辑成员进入仓库时看到的公告内容。</p>
              </div>
              <button class="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700" @click="useStandardAnnouncement">填入标准公告</button>
            </div>
            <div class="mt-5 grid gap-5 xl:grid-cols-[15rem_minmax(0,1fr)]">
              <div>
                <label class="mb-2 block text-sm font-semibold text-slate-700">仓库可见性</label>
                <select class="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none" :value="visibility" @change="saveVisibility($event.target.value)">
                  <option value="private">私有仓库</option>
                  <option value="public">公开到大厅</option>
                </select>
              </div>
              <div>
                <label class="mb-2 block text-sm font-semibold text-slate-700">编辑仓库公告</label>
                <textarea v-model="announcementDraft" rows="5" class="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none" placeholder="公告会展示给所有能查看该仓库的人"></textarea>
                <div class="mt-3 flex justify-end">
                  <button class="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white" @click="saveAnnouncement">保存公告</button>
                </div>
              </div>
            </div>
          </section>
        </div>

        <aside class="space-y-6">
          <section class="rounded-[32px] border border-slate-200 bg-white px-6 py-6 shadow-sm">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 class="text-xl font-semibold text-slate-900">协作权限</h3>
                <p class="mt-2 text-sm leading-7 text-slate-500">这里可以查看拥有者、协作者和待审核申请，并处理成员维护权限。</p>
              </div>
              <div class="rounded-[24px] bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <div>拥有者 {{ memberSummary.ownerCount }}</div>
                <div class="mt-1">协作者 {{ memberSummary.collaboratorCount }}</div>
              </div>
            </div>

            <div v-if="canManage" class="mt-5 flex flex-wrap gap-3">
              <input v-model="newMemberName" class="min-w-[14rem] flex-1 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none" placeholder="输入用户名，添加为协作者">
              <button class="rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white" @click="submitMember">添加协作者</button>
            </div>

            <div v-else-if="canRequestJoin" class="mt-5 space-y-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div class="text-sm text-slate-600">如果你想一起维护这个仓库，可以先提交申请，由仓库拥有者或管理员审核。</div>
              <textarea v-model="joinMessage" rows="3" class="w-full rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none" placeholder="可选：补充一句申请理由"></textarea>
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div v-if="myJoinRequest" class="text-sm text-slate-500">当前状态：{{ joinRequestStatusLabel(myJoinRequest) }}<span v-if="myJoinRequest.updated_at"> · {{ myJoinRequest.updated_at }}</span></div>
                <div class="flex flex-wrap gap-2">
                  <button v-if="canSubmitJoinRequest" class="rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white" @click="submitJoinRequest">{{ myJoinRequest ? '重新申请加入维护' : '申请加入维护' }}</button>
                  <button v-if="canCancelJoinRequest" class="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600" @click="cancelJoinRequest">取消申请</button>
                </div>
              </div>
            </div>

            <div v-if="canLeaveRepo" class="mt-5 rounded-3xl border border-rose-200 bg-rose-50 px-4 py-4">
              <div class="text-sm text-rose-700">你当前是这个仓库的协作者，可以主动退出维护。</div>
              <div class="mt-3 flex justify-end">
                <button class="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white" @click="leaveRepo">退出维护</button>
              </div>
            </div>

            <div class="mt-5 grid gap-3 sm:grid-cols-2">
              <div v-for="member in members" :key="member.username" class="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="truncate font-semibold text-slate-900">{{ member.username }}</div>
                    <div class="mt-1 text-sm text-slate-500">{{ member.role === 'owner' ? '拥有者' : '协作者' }}</div>
                  </div>
                  <button v-if="canManage && member.role !== 'owner'" class="shrink-0 rounded-2xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600" @click="removeMember(member.username)">移除</button>
                </div>
              </div>
            </div>

            <div v-if="canManage && joinRequests.length" class="mt-5 space-y-3 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4">
              <div class="text-sm font-semibold text-slate-900">待审核申请</div>
              <div v-for="request in joinRequests" :key="request.username" class="rounded-3xl border border-slate-200 bg-white px-4 py-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div class="font-semibold text-slate-900">{{ request.username }}</div>
                    <div class="mt-1 text-sm text-slate-500">{{ request.message || '未填写申请理由' }}</div>
                    <div class="mt-1 text-xs text-slate-400">提交于 {{ request.created_at || '未知时间' }}</div>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <button class="rounded-2xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white" @click="reviewJoinRequest(request.username, 'approve')">通过</button>
                    <button class="rounded-2xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600" @click="reviewJoinRequest(request.username, 'reject')">拒绝</button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section v-if="canManage" class="rounded-[32px] border border-slate-200 bg-white px-6 py-6 shadow-sm">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h3 class="text-xl font-semibold text-slate-900">仓库日志</h3>
                <p class="mt-2 text-sm leading-7 text-slate-500">记录成员、公告、文件和权限相关的仓库操作。</p>
              </div>
              <button class="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700" @click="openRepoLogs">查看日志</button>
            </div>

            <div v-if="latestRepoLog" class="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="text-sm font-semibold text-slate-900">{{ repoLogActionLabel(latestRepoLog.action) }}</div>
                <div class="text-xs text-slate-400">{{ latestRepoLog.created_at }}</div>
              </div>
              <div class="mt-2 text-sm text-slate-600">{{ latestRepoLog.actor_username }}</div>
              <div v-if="latestRepoLog.detail" class="mt-1 text-sm leading-6 text-slate-500">{{ latestRepoLog.detail }}</div>
            </div>

            <div v-else class="mt-5 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              暂时还没有仓库级管理日志。
            </div>
          </section>
        </aside>
      </section>
    </div>

    <div v-else class="rounded-[32px] border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-500">
      正在加载仓库详情...
    </div>

    <div v-if="entryNoticeOpen && repo" class="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 px-4" @click.self="closeEntryNotice">
      <div class="w-full max-w-2xl rounded-[32px] border border-slate-200 bg-white p-6 shadow-2xl md:p-7">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-sm font-medium uppercase tracking-[0.24em] text-sky-600">Repository Notice</div>
            <h3 class="mt-2 text-2xl font-bold text-slate-900">{{ entryNoticeTitle }}</h3>
            <p class="mt-2 text-sm text-slate-500">{{ repo.name }} · {{ repo.owner_username }}</p>
          </div>
          <button class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600" @click="closeEntryNotice">关闭</button>
        </div>

        <div class="mt-5 rounded-[28px] border border-slate-200 bg-slate-50 px-5 py-5">
          <p class="whitespace-pre-wrap text-sm leading-7 text-slate-700">{{ entryNoticeBody }}</p>
        </div>

        <div class="mt-5 flex flex-wrap justify-end gap-3">
          <button v-if="canManage" class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700" @click="useStandardAnnouncement">插入标准公告</button>
          <button class="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white" @click="closeEntryNotice">进入仓库</button>
        </div>
      </div>
    </div>

    <div v-if="repoLogModalOpen && canManage" class="fixed inset-0 z-[121] flex items-center justify-center bg-slate-950/45 px-4" @click.self="closeRepoLogs">
      <div class="w-full max-w-3xl rounded-[32px] border border-slate-200 bg-white p-6 shadow-2xl md:p-7">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-sm font-medium uppercase tracking-[0.24em] text-sky-600">Repository Logs</div>
            <h3 class="mt-2 text-2xl font-bold text-slate-900">仓库日志</h3>
            <p class="mt-2 text-sm text-slate-500">{{ repo.name }} 的协作与维护记录</p>
          </div>
          <button class="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600" @click="closeRepoLogs">关闭</button>
        </div>

        <div v-if="repoLogs.length" class="mt-5 max-h-[26rem] space-y-3 overflow-y-auto pr-1">
          <div v-for="log in repoLogs" :key="log.id" class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="text-sm font-semibold text-slate-900">{{ repoLogActionLabel(log.action) }}</div>
              <div class="text-xs text-slate-400">{{ log.created_at }}</div>
            </div>
            <div class="mt-2 text-sm text-slate-600">操作人：{{ log.actor_username }}</div>
            <div v-if="log.detail" class="mt-1 text-sm leading-6 text-slate-500">{{ log.detail }}</div>
          </div>
        </div>

        <div v-else class="mt-5 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          暂时还没有仓库级管理日志。
        </div>
      </div>
    </div>
  `,
};
