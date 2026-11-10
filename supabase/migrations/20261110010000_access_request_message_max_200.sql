alter table public.access_requests drop constraint if exists access_requests_message_max_250;
alter table public.access_requests add constraint access_requests_message_max_200 check (char_length(message) <= 200);
