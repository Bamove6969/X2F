-- Review lead-mod-chat t7-9 N4 (chat membership design task 8). API number 715.
--
-- When the person was last switched off. `switched_off_at` is cleared on switch-on, but the
-- moderation gate revokes every device a person certified before a switch-off (and before a removal
-- or a security reset), so this API's own view of their live devices must drop those
-- certifications too, after they are switched on again. Set with every switch-off and removal;
-- never cleared.
alter table staff_members add column last_switched_off_at timestamptz;
update staff_members set last_switched_off_at = switched_off_at where switched_off_at is not null;
