create or replace function public.workspace_read_delta(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare full_data jsonb; tokens jsonb='{}'; changed jsonb='[]'; m integer; block jsonb; token text; meta jsonb; result jsonb;
begin
 full_data:=public.order_workspace('read',jsonb_build_object('year',payload->'year'));
 for m in 1..12 loop
  block:=jsonb_build_object('rows',coalesce((select jsonb_agg(v order by (v->>'position')::integer) from jsonb_array_elements(full_data->'rows') v where (v->>'month')::integer=m),'[]'::jsonb),'formats',coalesce(full_data->'formats'->m::text,'{}'::jsonb));
  token:=md5(block::text);tokens:=tokens||jsonb_build_object(m::text,token);
  if payload->'tokens'->>m::text is distinct from token then changed:=changed||jsonb_build_array(m);end if;
 end loop;
 meta:=full_data-'rows'-'formats';token:=md5(meta::text);tokens:=tokens||jsonb_build_object('meta',token);
 result:=jsonb_build_object('tokens',tokens,'changed_months',changed,
 'rows',coalesce((select jsonb_agg(v) from jsonb_array_elements(full_data->'rows') v where changed @> jsonb_build_array((v->>'month')::integer)),'[]'::jsonb),
 'formats',coalesce((select jsonb_object_agg(k,v) from jsonb_each(full_data->'formats') as f(k,v) where changed @> jsonb_build_array(k::integer)),'{}'::jsonb));
 if payload->'tokens'->>'meta' is distinct from token then result:=result||jsonb_build_object('metadata',meta);end if;
 return result;
end $$;
revoke all on function public.workspace_read_delta(jsonb) from public,anon;
grant execute on function public.workspace_read_delta(jsonb) to authenticated;
