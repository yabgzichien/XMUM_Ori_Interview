'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { uploadAvatar, removeAvatar } from '@/lib/profile'
import { positionLabel } from '@/lib/practice'
import { useToast } from '@/components/Toast'
import { errorMessage } from '@/lib/utils'

const roleLabels: Record<string, string> = {
  applicant: 'Applicant',
  head_facilitator: 'Head of Facilitators',
  head_gm: 'Head of Game Masters',
  admin: 'Admin',
  committee: 'Committee Member',
  performance_lead: 'Performance Lead',
}

type Profile = {
  id: string
  name?: string | null
  email?: string | null
  role: string
  position?: string | null
  avatar_url?: string | null
}

export function ProfileClient({ profile }: { profile: Profile }) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url ?? null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null)
  const { showToast, toastElement } = useToast()

  const initials = (profile.name?.trim()
    ? profile.name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('')
    : profile.email?.slice(0, 2) || 'SC'
  ).toUpperCase()

  const roleLabel = profile.position ? positionLabel(profile.position) : roleLabels[profile.role] || profile.role

  function handlePickFile() {
    fileInputRef.current?.click()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    const localPreview = URL.createObjectURL(file)
    setPreviewUrl(localPreview)
    setBusy('upload')
    try {
      const newUrl = await uploadAvatar(profile.id, file)
      setAvatarUrl(newUrl)
      showToast('Profile picture updated.', 'success')
      router.refresh()
    } catch (err) {
      showToast(errorMessage(err), 'error')
    } finally {
      URL.revokeObjectURL(localPreview)
      setPreviewUrl(null)
      setBusy(null)
    }
  }

  async function handleRemove() {
    setBusy('remove')
    try {
      await removeAvatar(profile.id)
      setAvatarUrl(null)
      showToast('Profile picture removed.', 'success')
      router.refresh()
    } catch (err) {
      showToast(errorMessage(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  const displayUrl = previewUrl ?? avatarUrl

  return (
    <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '28px', boxShadow: '0 8px 30px -16px rgba(16,24,40,.16)' }}>
      {toastElement}
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: '96px', height: '96px', flexShrink: 0 }}>
          {displayUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={displayUrl}
              alt="Profile picture"
              style={{ width: '96px', height: '96px', borderRadius: '50%', objectFit: 'cover', border: '1px solid #EAEEF4', opacity: busy === 'upload' ? 0.6 : 1 }}
            />
          ) : (
            <div style={{ width: '96px', height: '96px', borderRadius: '50%', background: '#EEF2F7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '30px', color: '#475569', opacity: busy === 'upload' ? 0.6 : 1 }}>
              {initials}
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: '180px' }}>
          <div style={{ fontSize: '17px', fontWeight: 700, color: '#0F172A' }}>{profile.name || profile.email}</div>
          <div style={{ fontSize: '13.5px', color: '#64748B', marginTop: '2px' }}>{profile.email}</div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '99px', background: '#EFF4FF', color: '#2563EB', fontSize: '12px', fontWeight: 700, border: '1px solid #DBE6FF', marginTop: '8px' }}>
            {roleLabel}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '22px', flexWrap: 'wrap' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          onClick={handlePickFile}
          disabled={busy !== null}
          style={{ padding: '10px 16px', borderRadius: '10px', border: 'none', background: '#2563EB', color: '#fff', fontWeight: 700, fontSize: '14px', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}
        >
          {busy === 'upload' ? 'Uploading...' : avatarUrl ? 'Change picture' : 'Upload picture'}
        </button>
        {avatarUrl && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy !== null}
            style={{ padding: '10px 16px', borderRadius: '10px', border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', fontWeight: 600, fontSize: '14px', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.7 : 1 }}
          >
            {busy === 'remove' ? 'Removing...' : 'Remove picture'}
          </button>
        )}
      </div>
      <p style={{ fontSize: '12.5px', color: '#94A3B8', marginTop: '12px', marginBottom: 0 }}>
        JPG, PNG, or WEBP. Up to 3MB.
      </p>
    </div>
  )
}
