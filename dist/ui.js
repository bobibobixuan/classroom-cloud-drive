import { reactive } from './deps.js';

export const uiState = reactive({
  toasts: [],
  chatOpen: false,
  renameOpen: false,
  securityOpen: false,
  deleteAccountOpen: false,
  confirm: {
    open: false,
    title: '请确认操作',
    message: '确定继续吗？',
    confirmText: '确认',
    cancelText: '取消',
    danger: true,
  },
});

let confirmResolver = null;
let nextToastId = 1;

export function showToast(message, type = 'info') {
  if (!message) return;
  const id = nextToastId++;
  uiState.toasts.push({ id, message, type });
  window.setTimeout(() => {
    const index = uiState.toasts.findIndex((item) => item.id === id);
    if (index >= 0) {
      uiState.toasts.splice(index, 1);
    }
  }, 3200);
}

export function confirmAction(options = {}) {
  uiState.confirm = {
    open: true,
    title: options.title || '请确认操作',
    message: options.message || '确定继续吗？',
    confirmText: options.confirmText || '确认',
    cancelText: options.cancelText || '取消',
    danger: options.danger !== false,
  };
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

export function resolveConfirm(result) {
  uiState.confirm.open = false;
  const resolver = confirmResolver;
  confirmResolver = null;
  resolver?.(result);
}

export function toggleChat(open) {
  uiState.chatOpen = typeof open === 'boolean' ? open : !uiState.chatOpen;
}

export function openRename() {
  uiState.renameOpen = true;
}

export function closeRename() {
  uiState.renameOpen = false;
}

export function openSecurity() {
  uiState.securityOpen = true;
}

export function closeSecurity() {
  uiState.securityOpen = false;
}

export function openDeleteAccount() {
  uiState.securityOpen = false;
  uiState.deleteAccountOpen = true;
}

export function closeDeleteAccount() {
  uiState.deleteAccountOpen = false;
}
