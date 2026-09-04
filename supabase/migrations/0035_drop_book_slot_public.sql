-- 0035_drop_book_slot_public.sql
-- book_slot_public is superseded by reserve_slot + confirm_reservation
-- (0034). Nothing calls it anymore — BookClient.tsx now goes through the
-- hold flow instead of one-shot booking.
drop function if exists book_slot_public(uuid, text, text, text, text);

notify pgrst, 'reload schema';
