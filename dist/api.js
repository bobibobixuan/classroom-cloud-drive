export async function apiRequest(path, options = {}, token = '') {
  const finalOptions = { ...options, headers: { ...(options.headers || {}) } };
  if (token) {
    finalOptions.headers.Authorization = `Bearer ${token}`;
  }
  return fetch(path, finalOptions);
}

export async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || '请求失败');
  }
  return data;
}

export async function downloadBlob(response, fallbackName) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || '下载失败');
  }
  const blob = await response.blob();
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = fallbackName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function uploadWithProgress(path, formData, token, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded, event.total);
      }
    });
    xhr.addEventListener('load', () => {
      resolve({ status: xhr.status, bodyText: xhr.responseText || '{}' });
    });
    xhr.addEventListener('error', () => {
      reject(new Error('网络连接失败'));
    });
    xhr.open('POST', path);
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    xhr.send(formData);
  });
}
