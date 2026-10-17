-- Cocktail quizzes read Method and Glassware from their own fields.
-- Run once in the Supabase SQL editor. Nothing is deleted: this only updates the
-- automatic quiz builder. It uses the Method / Glassware fields first and falls back
-- to the old description text, so no cocktail loses its questions.
-- Nothing is removed from the database.
begin;

create or replace function public.build_auto_menu_quiz(mid uuid) returns jsonb
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
  answer:=coalesce(nullif(trim(m.details->>'method'),''),nullif(trim(substring(m.description from E'Method: ([^\n]+)')),''),'Method not recorded');
  q:=q||jsonb_build_array(public.quiz_choice('Which preparation method is recorded for '||stem||'?',answer,array['Shake','Stir','Building','Method not recorded'],'Preparation method'));
  answer:=coalesce(nullif(trim(m.details->>'glassware'),''),nullif(trim(substring(m.description from E'Glassware: ([^\n]+)')),''),'Glassware not recorded');
  select array_agg(distinct coalesce(nullif(trim(details->>'glassware'),''),trim(substring(description from E'Glassware: ([^\n]+)')))) into pool from public.menu_items where restaurant_id=m.restaurant_id and content_type='cocktails';
  q:=q||jsonb_build_array(public.quiz_choice('Which glassware is recorded for '||stem||'?',answer,pool,'Glassware'));
 elsif m.content_type='wine' then
  answer:=coalesce(nullif(trim(m.details->>'region'),''),'Region not recorded');
  select array_agg(distinct trim(details->>'region')) into pool from public.menu_items where restaurant_id=m.restaurant_id and content_type='wine';
  q:=q||jsonb_build_array(public.quiz_choice('Where does '||stem||' come from?',answer,pool,'Origin'));
  answer:=coalesce(nullif(trim(m.details->>'producer'),''),'Producer not recorded');
  select array_agg(distinct trim(details->>'producer')) into pool from public.menu_items where restaurant_id=m.restaurant_id and content_type='wine';
  q:=q||jsonb_build_array(public.quiz_choice('Who makes '||stem||'?',answer,pool,'Producer'));
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

commit;
