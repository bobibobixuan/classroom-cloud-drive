import { reactive } from './deps.js';
import { apiRequest, readJson, downloadBlob, uploadWithProgress } from './api.js';
import { showToast } from './ui.js';

export const state = reactive({
  token: localStorage.getItem('token') || '',
  user: localStorage.getItem('user') || '',
  realName: '',
  isAdmin: false,
  isSuperAdmin: false,
  role: '',
  adminScopes: [],
  ready: false,
  bootstrapping: false,
  driveFiles: [],
  selectedDriveFiles: [],
  myRepos: [],
  hallRepos: [],
  adminUsers: [],
  adminRegistrationWhitelist: [],
  adminRepos: [],
  adminShares: [],
  recycleBinItems: [],
  auditLogs: [],
  notifications: [],
  notificationUnreadCount: 0,
  activeRepo: null,
  chatMessages: [],
  chatSignature: '',
  busy: {},
  driveUpload: {
    visible: false,
    fileName: '',
    percent: 0,
    statusText: '0 / 0 MB',
  },
});

let chatStream = null;
let chatReconnectTimer = null;

function setBusy(key, value) {
  state.busy[key] = value;
}

export function isBusy(key) {
  return !!state.busy[key];
}

function syncIdentity(payload) {
  const has = (key) => Object.prototype.hasOwnProperty.call(payload || {}, key);
  state.user = has('username') ? (payload.username || '') : state.user;
  state.realName = has('real_name') ? (payload.real_name || '') : state.realName;
  state.isAdmin = has('is_admin') ? !!payload.is_admin : state.isAdmin;
  state.isSuperAdmin = has('is_super_admin') ? !!payload.is_super_admin : state.isSuperAdmin;
  if (has('role')) {
    state.role = payload.role || '';
  } else if (!state.role) {
    state.role = state.isSuperAdmin ? 'super_admin' : (state.isAdmin ? 'admin' : 'user');
  }
  state.adminScopes = has('admin_scopes') ? (payload.admin_scopes || []) : state.adminScopes;
  if (state.user) {
    localStorage.setItem('user', state.user);
  }
}

function resetCollections() {
  state.driveFiles = [];
  state.selectedDriveFiles = [];
  state.myRepos = [];
  state.hallRepos = [];
  state.adminUsers = [];
  state.adminRegistrationWhitelist = [];
  state.adminRepos = [];
  state.adminShares = [];
  state.recycleBinItems = [];
  state.auditLogs = [];
  state.notifications = [];
  state.notificationUnreadCount = 0;
  state.activeRepo = null;
  state.chatMessages = [];
  state.chatSignature = '';
}

function stopChatStream() {
  if (chatReconnectTimer) {
    window.clearTimeout(chatReconnectTimer);
    chatReconnectTimer = null;
  }
  if (chatStream) {
    chatStream.close();
    chatStream = null;
  }
}

function clearSessionState() {
  stopChatStream();
  state.token = '';
  state.user = '';
  state.realName = '';
  state.isAdmin = false;
  state.isSuperAdmin = false;
  state.role = '';
  state.adminScopes = [];
  state.ready = false;
  state.bootstrapping = false;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  resetCollections();
}

async function requestWithAuth(path, options = {}) {
  const response = await apiRequest(path, options, state.token);
  if (response.status === 401) {
    clearSessionState();
    const authError = new Error('登录已过期，请重新登录');
    authError.code = 'AUTH_EXPIRED';
    throw authError;
  }
  return response;
}

async function jsonWithAuth(path, options = {}) {
  return readJson(await requestWithAuth(path, options));
}

function updateChatMessages(messages) {
  const nextMessages = messages || [];
  const signature = JSON.stringify(nextMessages);
  if (signature === state.chatSignature) {
    return false;
  }
  state.chatSignature = signature;
  state.chatMessages = nextMessages;
  return true;
}

function startChatStream() {
  if (!state.token || chatStream) return;
  chatStream = new EventSource('/api/chat/stream');
  chatStream.onmessage = (event) => {
    try {
      updateChatMessages(JSON.parse(event.data || '[]'));
    } catch (error) {
      console.error(error);
    }
  };
  chatStream.onerror = () => {
    stopChatStream();
    if (!state.token) return;
    chatReconnectTimer = window.setTimeout(() => {
      startChatStream();
    }, 3000);
  };
}

async function withBusy(key, task) {
  if (isBusy(key)) return null;
  setBusy(key, true);
  try {
    return await task();
  } finally {
    setBusy(key, false);
  }
}

async function loadChatCore() {
  updateChatMessages(await readJson(await apiRequest('/api/chat', {}, state.token)));
}

function normalizeProgress(loaded, total) {
  const percent = total ? Math.round((loaded / total) * 100) : 0;
  const loadedMb = (loaded / 1024 / 1024).toFixed(1);
  const totalMb = (total / 1024 / 1024).toFixed(1);
  return {
    percent,
    statusText: `${loadedMb} / ${totalMb} MB`,
  };
}

function compressImage(file, base64) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      if (width > 1400) {
        height = Math.round((height * 1400) / width);
        width = 1400;
      }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL(file.type, 0.78));
    };
    img.src = base64;
  });
}

async function shareDriveFileToChat(filename, { silent = false } = {}) {
  const share = await jsonWithAuth(`/api/share/${encodeURIComponent(filename)}`, { method: 'POST' });
  const formData = new FormData();
  formData.append('content', `我在个人云盘分享了文件：${filename}`);
  formData.append('share_code', share.code);
  await jsonWithAuth('/api/chat', { method: 'POST', body: formData });
  if (!silent) {
    await loadChatCore();
    showToast(`已把 ${filename} 分享到聊天`, 'success');
  }
}

export const actions = {
  async bootstrap() {
    if (state.bootstrapping) {
      return state.ready;
    }
    if (!state.token) {
      clearSessionState();
      return false;
    }
    state.bootstrapping = true;
    try {
      await this.refreshIdentity();
      await loadChatCore();
      await this.loadNotifications();
      startChatStream();
      state.ready = true;
      return true;
    } catch (error) {
      clearSessionState();
      return false;
    } finally {
      state.bootstrapping = false;
    }
  },

  async login(username, password) {
    const formData = new FormData();
    formData.append('username', username.trim());
    formData.append('password', password);
    const data = await readJson(await apiRequest('/api/login', { method: 'POST', body: formData }));
    state.token = data.token;
    localStorage.setItem('token', state.token);
    syncIdentity(data);
    state.ready = true;
    await loadChatCore();
    await this.loadNotifications();
    startChatStream();
    return data;
  },

  async refreshIdentity() {
    const me = await jsonWithAuth('/api/me');
    syncIdentity(me);
    return me;
  },

  async register(username, password, phone) {
    const formData = new FormData();
    formData.append('username', username.trim());
    formData.append('password', password);
    formData.append('phone', phone.trim());
    return readJson(await apiRequest('/api/register', { method: 'POST', body: formData }));
  },

  logout() {
    clearSessionState();
    location.assign('/login');
  },

  async loadDrive() {
    const data = await jsonWithAuth('/api/drive');
    syncIdentity(data);
    state.driveFiles = data.files || [];
    state.selectedDriveFiles = [];
    return data;
  },

  toggleDriveSelection(filename, checked) {
    const selected = new Set(state.selectedDriveFiles);
    if (checked) selected.add(filename);
    else selected.delete(filename);
    state.selectedDriveFiles = Array.from(selected);
  },

  setAllDriveSelection(checked) {
    state.selectedDriveFiles = checked ? state.driveFiles.map((file) => file.name) : [];
  },

  async updateDriveShareScope(filename, shareScope) {
    const formData = new FormData();
    formData.append('share_scope', shareScope);
    await jsonWithAuth(`/api/drive/files/${encodeURIComponent(filename)}/share-scope`, { method: 'POST', body: formData });
    await this.loadDrive();
  },

  async applyBatchShareScope(filenames, shareScope) {
    const formData = new FormData();
    formData.append('share_scope', shareScope);
    filenames.forEach((name) => formData.append('filenames', name));
    await jsonWithAuth('/api/drive/files/batch-share-scope', { method: 'POST', body: formData });
    await this.loadDrive();
  },

  async batchDeleteDriveFiles(filenames) {
    const formData = new FormData();
    filenames.forEach((name) => formData.append('filenames', name));
    await withBusy('drive-batch-delete', async () => {
      await jsonWithAuth('/api/drive/files/batch-delete', { method: 'POST', body: formData });
      await this.loadDrive();
    });
  },

  async batchShareToChat(filenames) {
    const selectedFiles = state.driveFiles.filter((file) => filenames.includes(file.name));
    const blocked = selectedFiles.filter((file) => file.share_scope === 'private');
    const allowed = selectedFiles.filter((file) => file.share_scope !== 'private');
    if (!allowed.length) {
      throw new Error('所选文件都还是私密状态，不能发到聊天栏');
    }
    for (const file of allowed) {
      await shareDriveFileToChat(file.name, { silent: true });
    }
    await loadChatCore();
    if (blocked.length) {
      showToast(`已分享 ${allowed.length} 个文件，另外 ${blocked.length} 个私密文件被跳过。`, 'warning');
    } else {
      showToast(`已分享 ${allowed.length} 个文件到聊天栏`, 'success');
    }
  },

  async uploadDriveFile(file) {
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    state.driveUpload.visible = true;
    state.driveUpload.fileName = file.name;
    state.driveUpload.percent = 0;
    state.driveUpload.statusText = '0 / 0 MB';
    try {
      await withBusy('drive-upload', async () => {
        const response = await uploadWithProgress('/api/drive/upload', formData, state.token, (loaded, total) => {
          const progress = normalizeProgress(loaded, total);
          state.driveUpload.percent = progress.percent;
          state.driveUpload.statusText = progress.statusText;
        });
        const parsed = JSON.parse(response.bodyText || '{}');
        if (response.status !== 200) {
          throw new Error(parsed.detail || '上传失败');
        }
        state.driveUpload.percent = 100;
        state.driveUpload.statusText = '完成';
        await this.loadDrive();
        showToast(parsed.msg || `文件 ${file.name} 上传完成`, 'success');
      });
    } finally {
      window.setTimeout(() => {
        state.driveUpload.visible = false;
      }, 600);
    }
  },

  async downloadDriveFile(filename) {
    await downloadBlob(await requestWithAuth(`/api/drive/download/${encodeURIComponent(filename)}`), filename);
  },

  async deleteDriveFile(filename) {
    await jsonWithAuth(`/api/drive/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    await this.loadDrive();
  },

  async shareDriveFileToChat(filename) {
    await shareDriveFileToChat(filename);
  },

  async loadMyRepos() {
    const data = await jsonWithAuth('/api/repos/mine');
    state.myRepos = data.repos || [];
    return data;
  },

  async loadRepoHall() {
    const data = await readJson(await apiRequest('/api/repos/hall', {}, state.token));
    state.hallRepos = data.repos || [];
    return data;
  },

  async createRepo(payload) {
    const formData = new FormData();
    formData.append('name', payload.name.trim());
    formData.append('description', payload.description.trim());
    formData.append('visibility', payload.visibility);
    const data = await jsonWithAuth('/api/repos', { method: 'POST', body: formData });
    await Promise.all([this.loadMyRepos(), this.loadRepoHall()]);
    return data;
  },

  async loadRepoDetail(repoId) {
    const data = await jsonWithAuth(`/api/repos/${encodeURIComponent(repoId)}`);
    state.activeRepo = data;
    return data;
  },

  async updateRepoAnnouncement(repoId, announcement) {
    const formData = new FormData();
    formData.append('announcement', announcement.trim());
    await jsonWithAuth(`/api/repos/${encodeURIComponent(repoId)}/announcement`, { method: 'POST', body: formData });
    await Promise.all([this.loadMyRepos(), this.loadRepoHall(), this.loadRepoDetail(repoId)]);
  },

  async updateRepoVisibility(repoId, visibility) {
    const formData = new FormData();
    formData.append('visibility', visibility);
    await jsonWithAuth(`/api/repos/${encodeURIComponent(repoId)}/visibility`, { method: 'POST', body: formData });
    await Promise.all([this.loadMyRepos(), this.loadRepoHall(), this.loadRepoDetail(repoId)]);
  },

  async addRepoMember(repoId, username) {
    const formData = new FormData();
    formData.append('username', username.trim());
    await jsonWithAuth(`/api/repos/${encodeURIComponent(repoId)}/members`, { method: 'POST', body: formData });
    await Promise.all([this.loadMyRepos(), this.loadRepoHall(), this.loadRepoDetail(repoId)]);
  },

  async removeRepoMember(repoId, username) {
    await jsonWithAuth(`/api/repos/${encodeURIComponent(repoId)}/members/${encodeURIComponent(username)}`, { method: 'DELETE' });
    await Promise.all([this.loadMyRepos(), this.loadRepoHall(), this.loadRepoDetail(repoId)]);
  },

  async leaveRepo(repoId) {
    await jsonWithAuth(`/api/repos/${encodeURIComponent(repoId)}/members/me`, { method: 'DELETE' });
    await Promise.all([this.loadMyRepos(), this.loadRepoHall(), this.loadRepoDetail(repoId)]);
  },

  async requestRepoJoin(repoId, message = '') {
    const formData = new FormData();
    formData.append('message', message.trim());
    await jsonWithAuth(`/api/repos/${encodeURIComponent(repoId)}/join-requests`, { method: 'POST', body: formData });
    await Promise.all([this.loadRepoHall(), this.loadMyRepos(), this.loadRepoDetail(repoId)]);
  },

  async cancelRepoJoinRequest(repoId) {
    await jsonWithAuth(`/api/repos/${encodeURIComponent(repoId)}/join-requests/me`, { method: 'DELETE' });
    await Promise.all([this.loadRepoHall(), this.loadMyRepos(), this.loadRepoDetail(repoId)]);
  },

  async reviewRepoJoinRequest(repoId, username, action) {
    const formData = new FormData();
    formData.append('action', action);
    await jsonWithAuth(`/api/repos/${encodeURIComponent(repoId)}/join-requests/${encodeURIComponent(username)}`, { method: 'POST', body: formData });
    await Promise.all([this.loadRepoHall(), this.loadMyRepos(), this.loadRepoDetail(repoId)]);
  },

  async uploadRepoFiles(repoId, fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    const data = await jsonWithAuth(`/api/repos/${encodeURIComponent(repoId)}/upload`, { method: 'POST', body: formData });
    await Promise.all([this.loadMyRepos(), this.loadRepoHall(), this.loadRepoDetail(repoId)]);
    showToast(data.msg || `已上传 ${files.length} 个文件`, 'success');
  },

  async downloadRepoFile(repoId, path) {
    await downloadBlob(await requestWithAuth(`/api/repos/${encodeURIComponent(repoId)}/files/${encodeURIComponent(path)}`), path.split('/').pop() || path);
  },

  async deleteRepoFile(repoId, path) {
    await jsonWithAuth(`/api/repos/${encodeURIComponent(repoId)}/files/${encodeURIComponent(path)}`, { method: 'DELETE' });
    await Promise.all([this.loadMyRepos(), this.loadRepoHall(), this.loadRepoDetail(repoId)]);
  },

  async loadAdminUsers() {
    if (!state.isAdmin) {
      state.adminUsers = [];
      return { users: [] };
    }
    const data = await jsonWithAuth('/api/admin/users');
    state.adminUsers = data.users || [];
    return data;
  },

  async loadAdminRegistrationWhitelist() {
    if (!state.isAdmin) {
      state.adminRegistrationWhitelist = [];
      return { items: [] };
    }
    const data = await jsonWithAuth('/api/admin/registration-whitelist');
    state.adminRegistrationWhitelist = data.items || [];
    return data;
  },

  async loadAdminRepos() {
    if (!state.isAdmin) {
      state.adminRepos = [];
      return { repos: [] };
    }
    const data = await jsonWithAuth('/api/admin/repos');
    state.adminRepos = data.repos || [];
    return data;
  },

  async loadAdminShares() {
    if (!state.isAdmin) {
      state.adminShares = [];
      return { shares: [] };
    }
    const data = await jsonWithAuth('/api/admin/shares');
    state.adminShares = data.shares || [];
    return data;
  },

  async loadRecycleBin() {
    if (!state.isAdmin) {
      state.recycleBinItems = [];
      return { items: [] };
    }
    const data = await jsonWithAuth('/api/admin/recycle-bin');
    state.recycleBinItems = data.items || [];
    return data;
  },

  async loadAuditLogs(limit = 200) {
    if (!state.isAdmin) {
      state.auditLogs = [];
      return { logs: [] };
    }
    const data = await jsonWithAuth(`/api/admin/audit-logs?limit=${encodeURIComponent(limit)}`);
    state.auditLogs = data.logs || [];
    return data;
  },

  async loadNotifications(limit = 40) {
    if (!state.token) {
      state.notifications = [];
      state.notificationUnreadCount = 0;
      return { items: [], unread_count: 0 };
    }
    const data = await jsonWithAuth(`/api/notifications?limit=${encodeURIComponent(limit)}`);
    state.notifications = data.items || [];
    state.notificationUnreadCount = data.unread_count || 0;
    return data;
  },

  async markNotificationsRead() {
    if (!state.token || !state.notificationUnreadCount) {
      return { msg: '没有未读通知' };
    }
    const data = await jsonWithAuth('/api/notifications/read', { method: 'POST' });
    state.notificationUnreadCount = 0;
    state.notifications = state.notifications.map((item) => ({ ...item, is_read: true }));
    return data;
  },

  async toggleAdmin(username, nextIsAdmin) {
    const formData = new FormData();
    formData.append('target_username', username);
    formData.append('is_admin', nextIsAdmin ? '1' : '0');
    await jsonWithAuth('/api/admin/grant', { method: 'POST', body: formData });
    await this.refreshIdentity();
    await this.loadNotifications();
    await this.loadAdminUsers();
  },

  async createUserByAdmin(payload) {
    const formData = new FormData();
    formData.append('username', payload.username.trim());
    formData.append('password', payload.password);
    formData.append('phone', payload.phone.trim());
    formData.append('role', payload.role || 'user');
    formData.append('quota_bytes', String(payload.quotaBytes || 0));
    (payload.adminScopes || []).forEach((scope) => formData.append('admin_scopes', scope));
    await jsonWithAuth('/api/admin/users', { method: 'POST', body: formData });
    await this.loadAdminUsers();
  },

  async importRegistrationWhitelistByAdmin(file) {
    if (!file) {
      throw new Error('请先选择名单文件');
    }
    const formData = new FormData();
    formData.append('file', file);
    const data = await jsonWithAuth('/api/admin/registration-whitelist/import', { method: 'POST', body: formData });
    await this.loadAdminRegistrationWhitelist();
    return data;
  },

  async resetUserPasswordByAdmin(username, newPassword) {
    const formData = new FormData();
    formData.append('new_password', newPassword);
    await jsonWithAuth(`/api/admin/users/${encodeURIComponent(username)}/password`, { method: 'POST', body: formData });
  },

  async updateUserStatusByAdmin(username, isDisabled) {
    const formData = new FormData();
    formData.append('is_disabled', isDisabled ? '1' : '0');
    await jsonWithAuth(`/api/admin/users/${encodeURIComponent(username)}/status`, { method: 'POST', body: formData });
    await this.loadAdminUsers();
  },

  async updateUserQuotaByAdmin(username, quotaBytes) {
    const formData = new FormData();
    formData.append('quota_bytes', String(quotaBytes));
    await jsonWithAuth(`/api/admin/users/${encodeURIComponent(username)}/quota`, { method: 'POST', body: formData });
    await this.loadAdminUsers();
  },

  async updateUserRoleByAdmin(username, role, adminScopes = []) {
    const formData = new FormData();
    formData.append('role', role);
    adminScopes.forEach((scope) => formData.append('admin_scopes', scope));
    await jsonWithAuth(`/api/admin/users/${encodeURIComponent(username)}/role`, { method: 'POST', body: formData });
    await this.refreshIdentity();
    await this.loadNotifications();
    if (state.isAdmin) {
      await this.loadAdminUsers();
    } else {
      state.adminUsers = [];
      state.adminRegistrationWhitelist = [];
      state.adminRepos = [];
      state.adminShares = [];
      state.recycleBinItems = [];
      state.auditLogs = [];
    }
  },

  async transferUserAssetsByAdmin(username, targetUsername) {
    const formData = new FormData();
    formData.append('target_username', targetUsername.trim());
    await jsonWithAuth(`/api/admin/users/${encodeURIComponent(username)}/transfer-ownership`, { method: 'POST', body: formData });
    await Promise.all([this.loadAdminUsers(), this.loadAdminRepos(), this.loadRepoHall(), this.loadMyRepos()]);
  },

  async deleteUserByAdmin(username, transferTo = '') {
    const query = transferTo.trim() ? `?transfer_to=${encodeURIComponent(transferTo.trim())}` : '';
    await jsonWithAuth(`/api/admin/users/${encodeURIComponent(username)}${query}`, { method: 'DELETE' });
    await Promise.all([this.loadAdminUsers(), this.loadAdminRepos(), this.loadRepoHall(), this.loadMyRepos()]);
  },

  async deleteRepoByAdmin(repoId) {
    await jsonWithAuth(`/api/admin/repos/${encodeURIComponent(repoId)}`, { method: 'DELETE' });
    if (state.activeRepo?.repo?.id === repoId) {
      state.activeRepo = null;
    }
    await Promise.all([this.loadAdminRepos(), this.loadRepoHall(), this.loadMyRepos()]);
  },

  async updateSharePolicyByAdmin(code, payload) {
    const formData = new FormData();
    formData.append('password', payload.password || '');
    formData.append('expires_at', payload.expiresAt || '');
    formData.append('revoke', payload.revoke ? '1' : '0');
    await jsonWithAuth(`/api/admin/shares/${encodeURIComponent(code)}/policy`, { method: 'POST', body: formData });
    await this.loadAdminShares();
  },

  async revokeShareByAdmin(code) {
    await jsonWithAuth(`/api/admin/shares/${encodeURIComponent(code)}`, { method: 'DELETE' });
    await this.loadAdminShares();
  },

  async purgeRecycleBinByAdmin() {
    const data = await jsonWithAuth('/api/admin/recycle-bin/purge', { method: 'POST' });
    await this.loadRecycleBin();
    return data;
  },

  async renameAccount(newUsername) {
    const formData = new FormData();
    formData.append('new_username', newUsername.trim());
    const data = await jsonWithAuth('/api/rename', { method: 'POST', body: formData });
    state.user = data.new_username;
    localStorage.setItem('user', data.new_username);
    return data;
  },

  async deleteAccount(password) {
    const formData = new FormData();
    formData.append('password', password);
    await jsonWithAuth('/api/delete-account', { method: 'POST', body: formData });
    clearSessionState();
    location.assign('/login');
  },

  async loadChat() {
    await loadChatCore();
  },

  async sendChat(message) {
    const text = message.trim();
    if (!text) return;
    const formData = new FormData();
    formData.append('content', text);
    await withBusy('chat-send', async () => {
      await jsonWithAuth('/api/chat', { method: 'POST', body: formData });
      await loadChatCore();
    });
  },

  async sendImageToChat(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      throw new Error('图片过大，请选择小于 5MB 的图片');
    }
    await withBusy('chat-image-send', async () => {
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target.result);
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.readAsDataURL(file);
      });
      let nextImageData = base64Data;
      if (file.type === 'image/jpeg' || file.type === 'image/png') {
        nextImageData = await compressImage(file, base64Data);
      }
      const formData = new FormData();
      formData.append('image_data', nextImageData);
      await jsonWithAuth('/api/chat', { method: 'POST', body: formData });
      await loadChatCore();
    });
  },

  async resetChat() {
    await withBusy('chat-reset', async () => {
      await jsonWithAuth('/api/chat/reset', { method: 'POST' });
      await loadChatCore();
    });
  },

  async downloadShare(code) {
    const validation = await readJson(await apiRequest(`/api/validate/${encodeURIComponent(code)}`, {}, state.token));
    if (!validation.valid) {
      throw new Error(validation.reason || '分享不可用');
    }
    await downloadBlob(await apiRequest(`/api/s/${encodeURIComponent(code)}`, {}, state.token), validation.filename || 'shared-file');
  },
};
