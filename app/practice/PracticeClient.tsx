'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  getMyPracticeGroup,
  getAvailablePracticeGroups,
  joinPracticeGroup,
  leavePracticeGroup,
  type MyGroup,
  type AvailableGroup,
} from '@/lib/practice'
import { MyGroupPanel } from '@/app/practice/MyGroupPanel'

export function PracticeClient({ currentUserId }: { currentUserId: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [myGroup, setMyGroup] = useState<MyGroup | null>(null)
  const [availableGroups, setAvailableGroups] = useState<AvailableGroup[]>([])
  const [joiningId, setJoiningId] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data: group, error: groupErr } = await getMyPracticeGroup()
    if (groupErr) {
      setError(groupErr.message)
      setLoading(false)
      return
    }
    setMyGroup(group)

    if (!group) {
      const { data: groups, error: groupsErr } = await getAvailablePracticeGroups()
      if (groupsErr) {
        setError(groupsErr.message)
      }
      setAvailableGroups(groups ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleJoin(groupId: string) {
    setJoiningId(groupId)
    const { error: joinErr } = await joinPracticeGroup(groupId)
    setJoiningId(null)
    if (joinErr) {
      alert(joinErr.message)
      return
    }
    load()
  }

  async function handleLeave() {
    if (!window.confirm('Leave this practice group?')) return
    setLeaving(true)
    const { error: leaveErr } = await leavePracticeGroup()
    setLeaving(false)
    if (leaveErr) {
      alert(leaveErr.message)
      return
    }
    load()
  }

  if (loading) {
    return <div style={{ padding: '20px', color: '#64748B', fontSize: '14px' }}>Loading...</div>
  }
  if (error) {
    return <div style={{ padding: '20px', color: '#B91C1C', fontSize: '14px' }}>{error}</div>
  }

  if (!myGroup) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {availableGroups.length === 0 && (
          <div style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '32px', textAlign: 'center', color: '#64748B', fontSize: '14px' }}>
            No practice groups are open yet. Check back soon.
          </div>
        )}
        {availableGroups.map((g) => {
          const joinable = g.seats_left > 0 && g.status === 'open'
          const isManagedByUser = Boolean(currentUserId && g.lead_id === currentUserId)
          return (
            <div key={g.id} style={{ background: '#fff', border: '1px solid #EAEEF4', borderRadius: '18px', padding: '20px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', boxShadow: '0 1px 2px rgba(16,24,40,.04)', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>{g.name}</span>
                  {isManagedByUser && (
                    <span style={{ fontSize: '11.5px', fontWeight: 700, color: '#2563EB', background: '#EFF4FF', padding: '2px 8px', borderRadius: '99px' }}>
                      your group
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '13px', color: '#64748B' }}>
                  Performance Lead: {g.lead_name}{isManagedByUser ? ' (your group)' : ''} · {g.session_count} session{g.session_count === 1 ? '' : 's'} scheduled
                </div>
                {g.member_names.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                    {g.member_names.map((name) => (
                      <span key={name} style={{ padding: '4px 10px', borderRadius: '99px', background: '#F1F5F9', color: '#334155', fontSize: '12px', fontWeight: 600 }}>
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: joinable ? '#2563EB' : '#94A3B8' }}>{g.seats_left}</div>
                  <div style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 600 }}>seats left</div>
                </div>
                <button
                  type="button"
                  disabled={!joinable || joiningId === g.id}
                  onClick={() => handleJoin(g.id)}
                  style={{ padding: '10px 18px', borderRadius: '10px', border: 'none', background: joinable ? '#2563EB' : '#CBD5E1', color: '#fff', fontWeight: 700, fontSize: '13.5px', cursor: joinable ? 'pointer' : 'not-allowed' }}
                >
                  {joiningId === g.id ? 'Joining...' : g.status !== 'open' ? 'Closed' : g.seats_left > 0 ? 'Join group' : 'Full'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {!myGroup.is_lead && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" disabled={leaving} onClick={handleLeave} style={{ padding: '9px 16px', borderRadius: '9px', border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#B91C1C', fontWeight: 700, fontSize: '13px', cursor: leaving ? 'not-allowed' : 'pointer' }}>
            {leaving ? 'Leaving...' : 'Leave group'}
          </button>
        </div>
      )}
      <MyGroupPanel myGroup={myGroup} currentUserId={currentUserId} onGroupChanged={load} />
    </div>
  )
}
