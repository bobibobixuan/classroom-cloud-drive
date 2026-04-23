export function formatSize(size) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

export function resolveChatImageSrc(imageValue) {
  if (!imageValue) return '';
  if (
    imageValue.startsWith('data:') ||
    imageValue.startsWith('http://') ||
    imageValue.startsWith('https://') ||
    imageValue.startsWith('/')
  ) {
    return imageValue;
  }
  return `/api/chat/images/${encodeURIComponent(imageValue)}`;
}

export function stopEvent(event) {
  event.preventDefault();
  event.stopPropagation();
}

export function splitAccountDisplay(username, realName = '') {
  const primaryName = (username || '').trim();
  const secondaryName = (realName || '').trim();
  if (!primaryName) {
    return { primary: '', secondary: '' };
  }
  if (!secondaryName) {
    return { primary: primaryName, secondary: '' };
  }
  const suffix = `_${secondaryName}`;
  if (primaryName.endsWith(suffix) && primaryName.length > suffix.length) {
    return {
      primary: primaryName.slice(0, -suffix.length),
      secondary: secondaryName,
    };
  }
  return {
    primary: primaryName,
    secondary: secondaryName === primaryName ? '' : secondaryName,
  };
}
