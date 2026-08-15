# Modifications — 15 Aug 2026

## What changed (plain words)

- **Committee positions**: Committee members can now have a specific position (e.g. Head of Facilitator, Treasurer, Secretary, etc). Admins/heads can set these positions, and they show up in the roster.
- **Practice groups now self-managed by leads**: Performance leads can manage their own practice group directly — rename it, change capacity, add/remove members, and create/edit/delete their own practice sessions (with a location field), instead of needing a head/admin to do it for them.
- **Venue field added to booking slots**: Interview slots now have a venue, which is shown to students and included in their booking confirmation email (previously the email showed a hardcoded placeholder venue).
- **Simplified bulk slot creation**: Removed the old separate "Window Form" for creating booking windows — bulk slot creation was consolidated and improved in one form.
- **Tighter access rules**: Some practice-related actions were locked down to admin-only where they used to be open to heads too, to reduce accidental changes.
- **New "My Group" panel**: Practice group leads and members get a dedicated panel to view/manage their own group.
- **Documentation diagrams added**: New flowcharts (booking, interview booking, performance booking) added under `docs/` for reference.
- **Minor fixes**: Small tweaks to email formatting, migration scripts, and test coverage to match the above changes.
- **HOF/HOG scoped down for practice groups**: Committee members promoted to Head of Facilitator (HOF) or Head of Game Master (HOG) now use `/practice` exactly like a normal committee member — the position no longer grants visibility into every group, the committee roster, or another group's members. That cross-group view (and group governance) stays admin-only. HOF/HOG still grants real `/head` dashboard access for interview booking, unaffected.

## Where
All changes are committed to `main` and pushed to GitHub (commit `67e818c`).
