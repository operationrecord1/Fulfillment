begin;
alter table fulfillment_private.store_options add column if not exists tax_percentage numeric not null default 15 check(tax_percentage>=0 and tax_percentage<=1000000000);
do $update$
declare original text; updated text; a integer; b integer;
begin
 original:=pg_get_functiondef('fulfillment_private.order_workspace(text,jsonb)'::regprocedure);
 updated:=replace(original,'jsonb_build_object(''platforms'',platforms,''revision'',revision)','jsonb_build_object(''platforms'',platforms,''revision'',revision,''tax_percentage'',tax_percentage)');
 if updated=original then raise exception 'Options read anchor changed';end if;
 updated:=replace(updated,'{"platforms":["Amazon"],"revision":0}','{"platforms":["Amazon"],"revision":0,"tax_percentage":15}');
 a:=strpos(updated,' elsif action=''platforms'' then');b:=strpos(updated,' elsif action=''save_expense'' then');
 if a=0 or b<a then raise exception 'Settings action anchor changed';end if;
 updated:=substr(updated,1,a-1)||$action$
 elsif action in ('platforms','workspace_settings') then
   if payload->'platforms' is null or jsonb_typeof(payload->'platforms')<>'array' or jsonb_array_length(payload->'platforms')>50 then raise exception 'Maximum 50 platforms';end if;
   if exists(select 1 from jsonb_array_elements(payload->'platforms') x where jsonb_typeof(x)<>'string' or length(btrim(x#>>'{}')) not between 1 and 60) then raise exception 'Invalid platform name';end if;
   n:=coalesce((select tax_percentage from fulfillment_private.store_options where store_id=p.store_id),15);
   if action='workspace_settings' then
     if nullif(payload->>'tax_percentage','') is null then raise exception 'Enter a tax percentage';end if;
     n:=(payload->>'tax_percentage')::numeric;
     if n::text in ('NaN','Infinity','-Infinity') or n<0 or n>1000000000 then raise exception 'Enter a valid non-negative tax percentage';end if;
   end if;
   insert into fulfillment_private.store_options(store_id,platforms,tax_percentage)
   values(p.store_id,array(select value from (select btrim(x.value) value,min(x.ordinality) seq from jsonb_array_elements_text(payload->'platforms') with ordinality x(value,ordinality) group by btrim(x.value)) labels order by seq),n)
   on conflict(store_id) do update set platforms=excluded.platforms,tax_percentage=excluded.tax_percentage,revision=fulfillment_private.store_options.revision+1
   where fulfillment_private.store_options.revision=(payload->>'revision')::integer;
   if not found then raise exception 'Settings changed. Refresh before saving';end if;
   return (select jsonb_build_object('platforms',platforms,'tax_percentage',tax_percentage,'revision',revision) from fulfillment_private.store_options where store_id=p.store_id);
$action$||substr(updated,b);
 execute updated;
end $update$;
commit;
