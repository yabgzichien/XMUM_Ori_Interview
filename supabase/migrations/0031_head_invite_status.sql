-- 0031_head_invite_status.sql
-- Surface committee-invite status on head_bookings so the head dashboard can
-- show whether an approved applicant has been invited yet and whether they've
-- registered (claimed their invite). staff_invites.email is globally unique
-- (0010), so a plain left join on applicant_email is enough to find the
-- invite tied to a booking — both sides are already lowercased/trimmed at
-- write time (book_slot_public, inviteApprovedBookingAction).

DROP FUNCTION IF EXISTS head_bookings(track, orientation, int);
CREATE OR REPLACE FUNCTION head_bookings(p_track track, p_orientation orientation, p_year int DEFAULT 2026)
RETURNS TABLE (
  booking_id uuid, slot_id uuid, track track, orientation orientation, orientation_year int, starts_at timestamptz, ends_at timestamptz,
  applicant_name text, applicant_email text, student_id text, experiences text,
  interview_notes text, created_at timestamptz, interview_status text, venue text,
  invited_at timestamptz, invite_claimed_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT (auth_managed_track() = p_track OR is_admin()) THEN
    RAISE EXCEPTION 'not authorized for this track';
  END IF;
  RETURN QUERY
    SELECT b.id, b.slot_id, b.track, b.orientation, b.orientation_year, s.starts_at, s.ends_at,
           b.applicant_name, b.applicant_email, b.student_id, b.experiences,
           b.interview_notes, b.created_at, b.interview_status::text, s.venue,
           si.created_at, si.claimed_at
    FROM bookings b
    JOIN slots s ON s.id = b.slot_id
    LEFT JOIN staff_invites si ON si.email = b.applicant_email
    WHERE b.track = p_track AND b.orientation = p_orientation AND b.orientation_year = p_year AND b.status = 'booked'
    ORDER BY s.starts_at, b.applicant_name;
END $$;
GRANT EXECUTE ON FUNCTION head_bookings(track, orientation, int) TO authenticated;

NOTIFY pgrst, 'reload schema';
