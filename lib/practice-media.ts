const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'])

export function getYouTubeVideoId(value: string): string | null {
  try {
    const url = new URL(value)
    if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase()) || url.protocol !== 'https:') return null
    const id = url.hostname.toLowerCase() === 'youtu.be'
      ? url.pathname.split('/').filter(Boolean)[0]
      : url.pathname.startsWith('/embed/')
        ? url.pathname.split('/')[2]
        : url.searchParams.get('v')
    return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null
  } catch {
    return null
  }
}

export function getYouTubeEmbedUrl(value: string): string | null {
  const id = getYouTubeVideoId(value)
  return id ? `https://www.youtube.com/embed/${id}` : null
}

export function getDriveFileId(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'drive.google.com') return null
    const id = url.pathname.startsWith('/file/d/')
      ? url.pathname.split('/')[3]
      : url.searchParams.get('id')
    return id && /^[A-Za-z0-9_-]{10,100}$/.test(id) ? id : null
  } catch {
    return null
  }
}

export function getDrivePreviewUrl(value: string): string | null {
  const id = getDriveFileId(value)
  return id ? `https://drive.google.com/file/d/${id}/preview` : null
}

/** An iframe-embeddable URL for a YouTube or Google Drive link, otherwise null. */
export function getEmbedUrl(value: string): string | null {
  return getYouTubeEmbedUrl(value) ?? getDrivePreviewUrl(value)
}

export function isSecureExternalUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
