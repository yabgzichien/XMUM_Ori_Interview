import { describe, expect, it } from 'vitest'
import { getDriveFileId, getDrivePreviewUrl, getEmbedUrl } from '@/lib/practice-media'

describe('Google Drive media links', () => {
  const id = '1UcjDVjg8Q4Hz29CyYi8wxpOZBQ_H_paH'

  it('extracts the file id from share and open links', () => {
    expect(getDriveFileId(`https://drive.google.com/file/d/${id}/view?usp=sharing`)).toBe(id)
    expect(getDriveFileId(`https://drive.google.com/file/d/${id}/preview`)).toBe(id)
    expect(getDriveFileId(`https://drive.google.com/open?id=${id}`)).toBe(id)
    expect(getDriveFileId(`https://drive.google.com/uc?export=download&id=${id}`)).toBe(id)
  })

  it('rejects folders, other hosts and plain http', () => {
    expect(getDriveFileId('https://drive.google.com/drive/folders/1cYxtran1nb_jqS0IDY9onuASRfDJz5H5')).toBeNull()
    expect(getDriveFileId(`https://example.com/file/d/${id}/view`)).toBeNull()
    expect(getDriveFileId(`http://drive.google.com/file/d/${id}/view`)).toBeNull()
    expect(getDriveFileId('not a url')).toBeNull()
  })

  it('builds the embeddable preview url', () => {
    expect(getDrivePreviewUrl(`https://drive.google.com/file/d/${id}/view`)).toBe(`https://drive.google.com/file/d/${id}/preview`)
    expect(getDrivePreviewUrl('https://youtu.be/abcdefghijk')).toBeNull()
  })

  it('getEmbedUrl prefers YouTube, then Drive', () => {
    expect(getEmbedUrl('https://youtu.be/abcdefghijk')).toBe('https://www.youtube.com/embed/abcdefghijk')
    expect(getEmbedUrl(`https://drive.google.com/file/d/${id}/view`)).toBe(`https://drive.google.com/file/d/${id}/preview`)
    expect(getEmbedUrl('https://example.com/video.mp4')).toBeNull()
  })
})
