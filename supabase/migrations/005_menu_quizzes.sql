begin;
create table public.quiz_attempts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 menu_item_id uuid not null references public.menu_items(id) on delete cascade,
 menu_updated_at timestamptz not null,
 answers integer[] not null check (cardinality(answers)=6),
 correct integer not null check (correct between 0 and 6),
 questions jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create index on public.quiz_attempts(user_id,menu_item_id,created_at desc);
alter table public.quiz_attempts enable row level security;
revoke all on public.quiz_attempts from anon,authenticated;
grant select on public.quiz_attempts to authenticated;
create policy "Learners read own attempts" on public.quiz_attempts for select to authenticated using (user_id=auth.uid() and exists(select 1 from public.menu_items m where m.id=menu_item_id and public.can_read_restaurant(m.restaurant_id)));

create function public.quiz_choice(prompt text, answer text, pool text[], topic text) returns jsonb
language sql immutable set search_path='' as $$
 with candidates as (
 select v,min(priority) priority from (select unnest(pool) v,0 priority union all select unnest(array['Not recorded in this item','Use another item’s notes','Assume the recipe is the same for every item']),1) choices where v is not null and v<>'' and v<>answer group by v
 ), wrong as (select v from candidates order by priority,md5(prompt||v) limit 3),
 options as (select v from wrong union all select answer),
 ordered as (select v,row_number() over(order by md5(prompt||v)) - 1 as n from options)
 select jsonb_build_object('prompt',prompt,'topic',topic,'options',(select jsonb_agg(v order by n) from ordered),'correct',(select n from ordered where v=answer));
$$;

create function public.build_menu_quiz(mid uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare m public.menu_items; pool text[]; answer text; q jsonb := '[]'; stem text;
begin
 select * into m from public.menu_items where id=mid;
 if not found or not public.can_read_restaurant(m.restaurant_id) then raise exception 'Menu item unavailable'; end if;
 stem := m.name;
 select array_agg(distinct category) into pool from public.menu_items where restaurant_id=m.restaurant_id and content_type=m.content_type;
 q:=q||jsonb_build_array(public.quiz_choice('Which menu category contains '||stem||'?',m.category,pool,'Category'));
 select array_agg(distinct split_part(description,E'\n\n',1)) into pool from public.menu_items where restaurant_id=m.restaurant_id and content_type=m.content_type;
 q:=q||jsonb_build_array(public.quiz_choice('Which recorded description belongs to '||stem||'?',split_part(m.description,E'\n\n',1),pool,'Description'));
 select array_agg(distinct array_to_string(ingredients,', ')) into pool from public.menu_items where restaurant_id=m.restaurant_id and content_type=m.content_type;
 q:=q||jsonb_build_array(public.quiz_choice('Which ingredient list is recorded for '||stem||'?',array_to_string(m.ingredients,', '),pool,'Ingredients'));
 answer:=case when cardinality(m.allergens)=0 then 'Allergen information has not been provided. Ask the manager and kitchen/bar team to verify.' else array_to_string(m.allergens,' · ') end;
 select array_agg(distinct array_to_string(allergens,' · ')) into pool from public.menu_items where restaurant_id=m.restaurant_id;
 pool:=pool||array['Allergen information has not been provided. Ask the manager and kitchen/bar team to verify.'];
 q:=q||jsonb_build_array(public.quiz_choice('What do the recorded allergen notes say for '||stem||'? (CC means cross-contamination.)',answer,pool,'Allergen notes'));
 if m.content_type='cocktails' then
  answer:=coalesce(nullif(trim(substring(m.description from E'Method: ([^\n]+)')),''),'Method not recorded');
  q:=q||jsonb_build_array(public.quiz_choice('Which preparation method is recorded for '||stem||'?',answer,array['Shake','Stir','Building','Method not recorded'],'Preparation method'));
  answer:=coalesce(nullif(trim(substring(m.description from E'Glassware: ([^\n]+)')),''),'Glassware not recorded');
  select array_agg(distinct trim(substring(description from E'Glassware: ([^\n]+)'))) into pool from public.menu_items where restaurant_id=m.restaurant_id and content_type='cocktails';
  q:=q||jsonb_build_array(public.quiz_choice('Which glassware is recorded for '||stem||'?',answer,pool,'Glassware'));
 else
  answer:=case when position('Sauces and component recipes:' in m.description)>0 then coalesce(nullif(trim(split_part(split_part(split_part(m.description,'Sauces and component recipes:',2),E'\n\nSource:',1),':',1)),''),'No component recipe recorded') else 'No component recipe recorded' end;
  select array_agg(distinct trim(split_part(split_part(split_part(description,'Sauces and component recipes:',2),E'\n\nSource:',1),':',1))) into pool from public.menu_items where restaurant_id=m.restaurant_id and content_type='food' and position('Sauces and component recipes:' in description)>0;
  q:=q||jsonb_build_array(public.quiz_choice('Which sauce or component heads the recorded recipe notes for '||stem||'?',answer,pool,'Sauces and components'));
  select array_agg(distinct name) into pool from public.menu_items where restaurant_id=m.restaurant_id and content_type='food' and (id=m.id or split_part(description,E'\n\n',1)<>split_part(m.description,E'\n\n',1));
  q:=q||jsonb_build_array(public.quiz_choice('Which dish has this recorded description? '||split_part(m.description,E'\n\n',1),m.name,pool,'Dish recognition'));
 end if;
 return jsonb_build_object('version',md5(m.updated_at::text||q::text),'updated_at',m.updated_at::text,'questions',q);
end;
$$;

create function public.get_menu_quiz(mid uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare quiz jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 quiz:=public.build_menu_quiz(mid);
 return jsonb_build_object('version',quiz->>'version','questions',(select jsonb_agg(value-'correct' order by n) from jsonb_array_elements(quiz->'questions') with ordinality t(value,n)));
end;
$$;

create function public.submit_menu_quiz(mid uuid, expected_version text, selected_answers integer[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare quiz jsonb; result jsonb; score integer; saved_id uuid;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 -- Lock the item while validating its version and recording the result.
 perform 1 from public.menu_items where id=mid for share;
 quiz:=public.build_menu_quiz(mid);
 if (quiz->>'version') is distinct from expected_version then raise exception 'This quiz content changed. Reopen the quiz to study the latest version.'; end if;
 if selected_answers is null or cardinality(selected_answers)<>6 or array_lower(selected_answers,1)<>1 or exists(select 1 from unnest(selected_answers) a where a is null or a<0 or a>3) then raise exception 'Answer all six questions'; end if;
 select count(*)::integer into score from jsonb_array_elements(quiz->'questions') with ordinality t(value,n) where (value->>'correct')::integer=selected_answers[n];
 insert into public.quiz_attempts(user_id,menu_item_id,menu_updated_at,answers,correct,questions) values(auth.uid(),mid,(quiz->>'updated_at')::timestamptz,selected_answers,score,quiz->'questions') returning id into saved_id;
 return jsonb_build_object('id',saved_id,'correct',score,'questions',quiz->'questions','answers',to_jsonb(selected_answers));
end;
$$;

create function public.get_quiz_progress(rid uuid) returns table(menu_item_id uuid,correct integer,created_at timestamptz)
language sql stable security definer set search_path='' as $$
 select distinct on (a.menu_item_id) a.menu_item_id,a.correct,a.created_at
 from public.quiz_attempts a join public.menu_items m on m.id=a.menu_item_id
 where a.user_id=auth.uid() and m.restaurant_id=rid and public.can_read_restaurant(rid) and a.menu_updated_at=m.updated_at
 order by a.menu_item_id,a.created_at desc,a.id desc;
$$;
revoke all on function public.quiz_choice(text,text,text[],text),public.build_menu_quiz(uuid),public.get_menu_quiz(uuid),public.submit_menu_quiz(uuid,text,integer[]),public.get_quiz_progress(uuid) from public,anon,authenticated;
grant execute on function public.get_menu_quiz(uuid),public.submit_menu_quiz(uuid,text,integer[]),public.get_quiz_progress(uuid) to authenticated;
commit;
