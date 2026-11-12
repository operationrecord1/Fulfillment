-- Do not send hidden platform data to investor clients.
do $patch$
declare src text; old_text text; new_text text;
begin
 src:=pg_get_functiondef('public.order_workspace(text,jsonb)'::regprocedure);
 old_text:=' return result;'||chr(10)||'end $function$';
 new_text:=$replacement$ if action='read' and p.role::text='investor' then
  result:=jsonb_set(result,'{rows}',coalesce((select jsonb_agg(jsonb_set(item,'{data}',(item->'data')-'platform')) from jsonb_array_elements(result->'rows') item),'[]'::jsonb));
  result:=jsonb_set(result,'{options}',coalesce(result->'options','{}'::jsonb)-'platforms'-'platform_colors'-'platform_text_colors'-'monthly_targets');
  result:=jsonb_set(result,'{formats}',coalesce((select jsonb_object_agg(m.key,coalesce((select jsonb_object_agg(r.key,r.value-'platform') from jsonb_each(m.value) r),'{}'::jsonb)) from jsonb_each(coalesce(result->'formats','{}'::jsonb)) m),'{}'::jsonb));
 end if;
 return result;
end $function$$replacement$;
 if strpos(src,old_text)=0 then raise exception 'Expected workspace return not found'; end if;
 execute replace(src,old_text,new_text);
end $patch$;
