-- A made-up team inside Osaka - Miami, for showing the app (schedule, Assistant, Tutor, Team).
-- Run once in the Supabase SQL editor. Remove it all with osaka-demo-team-cleanup.sql.
--
-- Everyone here is invented: ten people whose emails end in @demo.heat.invalid (a domain that can't
-- receive mail) and whose accounts have no password, so nobody can sign in as them. They get:
--   * a schedule from Thu Oct 29 to Wed Nov 11, 2026 (the restaurant's weeks start on Thursday),
--     with Mateo over 40 hours and Sofía just over;
--   * one time-off request and one released shift waiting for a manager;
--   * quiz results on real cards (the questions the app builds for each card), some under 80%;
--   * tutor practice with what they missed (allergens on ceviches, soy CC on tiraditos, pisco);
--   * six dinner shift reports, Oct 29 to Nov 3, written by the made-up manager Ricardo:
--     an allergy, the ice machine twice, waits at the robata, low stock and shout-outs.
-- Nothing that already exists in the restaurant is changed.
begin;

do $$
declare
  rid uuid := (select id from public.restaurants where name = 'Osaka - Miami');
  tz text := 'America/New_York';
  people jsonb := '[
    {"key":"valentina","name":"Valentina Ruiz","role":"Server"},
    {"key":"mateo","name":"Mateo Herrera","role":"Server"},
    {"key":"sofia","name":"Sofía Castro","role":"Server"},
    {"key":"lucas","name":"Lucas Moreno","role":"Server"},
    {"key":"camila","name":"Camila Torres","role":"Server assistant"},
    {"key":"andres","name":"Andrés Vega","role":"Server assistant"},
    {"key":"tomas","name":"Tomás Silva","role":"Server assistant"},
    {"key":"isabella","name":"Isabella Rojas","role":"Bartender"},
    {"key":"elena","name":"Elena Duarte","role":"Host"},
    {"key":"ricardo","name":"Ricardo Paz","role":"Manager"}]';
  p jsonb;
  uid uuid;
  ids jsonb := '{}';
  owner uuid;
  d date;
  i integer;
  -- Each person's shifts: weekday (0 = Sunday) -> start time and hours, both weeks.
  plan jsonb := '{
    "valentina": {"4":["16:00",6.5],"5":["16:00",7],"6":["16:00",7],"0":["11:00",6],"1":["16:00",6]},
    "mateo":     {"4":["16:00",6.5],"5":["16:00",6.5],"6":["16:00",6.5],"0":["16:00",6.5],"1":["16:00",6.5],"2":["16:00",6.5],"3":["16:00",6.5]},
    "sofia":     {"4":["11:00",8.5],"5":["11:00",8],"6":["11:00",8.5],"0":["11:00",8],"3":["11:00",8]},
    "lucas":     {"5":["17:00",6],"6":["17:00",6],"0":["17:00",6],"2":["17:00",6]},
    "camila":    {"4":["16:30",6],"5":["16:30",6.5],"6":["16:30",6.5],"1":["16:30",6],"3":["16:30",6]},
    "andres":    {"5":["17:00",5.5],"6":["17:00",5.5],"2":["17:00",5.5],"3":["17:00",5.5]},
    "tomas":     {"4":["11:00",5],"0":["11:00",5],"1":["11:00",5],"2":["11:00",5]},
    "isabella":  {"4":["17:00",7],"5":["17:00",7.5],"6":["17:00",7.5],"2":["17:00",7],"3":["17:00",7]},
    "elena":     {"5":["16:30",6],"6":["16:30",6],"0":["11:00",5],"3":["16:30",6]},
    "ricardo":   {"4":["15:00",9],"5":["15:00",9],"6":["15:00",9],"2":["15:00",9],"3":["15:00",9]}
  }';
  slot jsonb;
  -- Quiz results: person -> list of [section, which card in it (0 = first by name), correct out of the quiz].
  quizzes jsonb := '{
    "valentina": [["Ceviches",0,1.0],["Ceviches",1,1.0],["Tiraditos",0,0.9],["Nigiris",0,1.0],["Nigiris",1,0.9],["Makimonos",0,1.0],["Hiyashi Zensai",0,1.0],["Yaki Zensai",0,0.9]],
    "mateo":     [["Ceviches",0,0.6],["Tiraditos",0,0.7],["Nigiris",0,0.9],["Makimonos",0,1.0],["Yaki Zensai",0,0.9]],
    "sofia":     [["Ceviches",0,1.0],["Ceviches",2,0.9],["Tiraditos",1,1.0],["Nigiris",2,0.9],["Hiyashi Zensai",1,1.0],["Bejitarian",0,0.9]],
    "lucas":     [["Tiraditos",0,0.6],["Nigiris",0,0.9],["Makimonos",1,0.9]],
    "camila":    [["Ceviches",0,0.5],["Ceviches",1,0.6],["Hiyashi Zensai",0,0.9],["Nigiris",0,0.9]],
    "tomas":     [["Nigiris",0,0.9],["Makimonos",0,0.8]],
    "isabella":  [["Pisuko Taiken",0,0.6],["Pisuko Taiken",1,0.9],["Neitibu",0,1.0],["Koten Kero",0,0.9]]
  }';
  q jsonb;
  item uuid;
  questions jsonb;
  total integer;
  good integer;
  picks integer[];
  attempt_day integer := 0;
begin
  if rid is null then raise exception 'There is no restaurant called Osaka - Miami.'; end if;
  if exists (select 1 from auth.users where email like '%@demo.heat.invalid') then
    raise exception 'The demo team is already there. Run osaka-demo-team-cleanup.sql first to start again.';
  end if;
  select owner_id into owner from public.restaurants where id = rid;
  -- build_menu_quiz checks who is asking: for this script only, it's the restaurant's owner.
  perform set_config('request.jwt.claim.sub', owner::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', owner, 'role', 'authenticated')::text, true);

  -- People: an account nobody can sign in to, a membership, and a profile with their name and role.
  for p in select * from jsonb_array_elements(people) loop
    uid := gen_random_uuid();
    ids := ids || jsonb_build_object(p->>'key', uid);
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', (p->>'key') || '@demo.heat.invalid',
      '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', p->>'name', 'demo_team', true), now(), now(), '', '', '', '');
    insert into public.restaurant_members(restaurant_id, user_id, access)
    values (rid, uid, case when p->>'key' = 'ricardo' then '{preshift}'::text[] else '{}'::text[] end);
    insert into public.member_profiles(restaurant_id, user_id, display_name, role) values (rid, uid, p->>'name', p->>'role');
  end loop;

  -- The schedule, published, Thu Oct 29 to Wed Nov 11.
  for d in select generate_series('2026-10-29'::date, '2026-11-11'::date, interval '1 day')::date loop
    for p in select * from jsonb_array_elements(people) loop
      slot := plan->(p->>'key')->(extract(dow from d)::integer::text);
      if slot is null then continue; end if;
      insert into public.schedule_shifts(restaurant_id, user_id, position, starts_at, ends_at, published, created_by)
      values (rid, (ids->>(p->>'key'))::uuid, p->>'role',
        (d + (slot->>0)::time) at time zone tz,
        (d + (slot->>0)::time) at time zone tz + make_interval(mins => round((slot->>1)::numeric * 60)::integer),
        true, owner);
    end loop;
  end loop;

  -- Waiting for a manager: Sofía's two days off, and Lucas giving up his Saturday.
  insert into public.time_off_requests(restaurant_id, user_id, starts_on, ends_on, note)
  values (rid, (ids->>'sofia')::uuid, '2026-11-14', '2026-11-15', 'Boda de mi hermana');
  insert into public.shift_changes(restaurant_id, kind, shift_id, requested_by, note)
  select rid, 'release', s.id, s.user_id, 'Examen de la universidad'
  from public.schedule_shifts s where s.user_id = (ids->>'lucas')::uuid and (s.starts_at at time zone tz)::date = '2026-11-07';

  -- Quizzes on real cards, with the app's own questions for each card.
  for p in select * from jsonb_array_elements(people) loop
    if quizzes->(p->>'key') is null then continue; end if;
    attempt_day := 0;
    for q in select * from jsonb_array_elements(quizzes->(p->>'key')) loop
      select m.id into item from public.menu_items m where m.restaurant_id = rid and m.category = q->>0 order by m.name offset (q->>1)::integer limit 1;
      if item is null then continue; end if;
      questions := public.build_menu_quiz(item)->'questions';
      total := coalesce(jsonb_array_length(questions), 0);
      if total = 0 then continue; end if;
      good := least(total, round(total * (q->>2)::numeric)::integer);
      picks := array(select case when n < good then (questions->n->>'correct')::integer
        else (((questions->n->>'correct')::integer + 1) % greatest(jsonb_array_length(questions->n->'options'), 2)) end
        from generate_series(0, total - 1) n);
      attempt_day := attempt_day + 1;
      insert into public.quiz_attempts(user_id, menu_item_id, menu_updated_at, answers, correct, total, questions, created_at)
      select (ids->>(p->>'key'))::uuid, item, m.updated_at, picks, good, total, questions,
        case when p->>'key' = 'tomas' then '2026-10-12 20:00-04'::timestamptz + make_interval(days => attempt_day)
             else '2026-10-26 20:00-04'::timestamptz + make_interval(days => attempt_day) end
      from public.menu_items m where m.id = item;
    end loop;
  end loop;

  -- Tutor practice: what they missed.
  insert into public.tutor_practice(restaurant_id, user_id, menu_item_id, result, missed, created_at)
  select rid, (ids->>x.who)::uuid, m.id, x.result, x.missed, x.at::timestamptz
  from (values
    ('camila', 'Ceviches', 0, 'wrong', 'Alérgeno: sésamo', '2026-11-02 15:00-05'),
    ('camila', 'Ceviches', 1, 'partly', 'Alérgeno: pescado en la leche de tigre', '2026-11-02 15:10-05'),
    ('lucas', 'Tiraditos', 0, 'partly', 'Soya (CC)', '2026-11-01 14:00-05'),
    ('isabella', 'Pisuko Taiken', 0, 'wrong', 'Tipo de pisco', '2026-11-01 13:00-05'),
    ('mateo', 'Ceviches', 0, 'partly', 'Alérgeno: sésamo', '2026-10-31 16:00-04'),
    ('valentina', 'Nigiris', 0, 'correct', '', '2026-11-02 12:00-05'),
    ('sofia', 'Tiraditos', 1, 'correct', '', '2026-11-01 11:00-05')
  ) as x(who, section, nth, result, missed, at)
  cross join lateral (select mi.id from public.menu_items mi where mi.restaurant_id = rid and mi.category = x.section order by mi.name offset x.nth limit 1) m;

  -- Dinner reports Oct 29 to Nov 3, by Ricardo.
  insert into public.shift_reports(restaurant_id, service_date, label, mood, covers, issues, urgent, low_stock, shoutouts, next_shift, notes, submitted_by, submitted_at)
  select rid, x.day::date, 'Dinner', x.mood, x.covers, x.issues::jsonb, x.urgent, x.low, x.shout, x.next, x.notes, (ids->>'ricardo')::uuid, (x.day::date + time '23:30') at time zone tz
  from (values
    ('2026-10-29', 'ok', 142, '[{"kind":"equipment","note":"La máquina de hielo dejó de producir a las 8pm; trajimos hielo del bar."}]', false, 'Erizo', 'Valentina con la mesa de 12', 'Revisar la máquina de hielo antes de abrir', ''),
    ('2026-10-30', 'rough', 210, '[{"kind":"complaint","note":"Espera de 35 min en robata, mesa 7."},{"kind":"complaint","note":"Mesa 15 se quejó de la espera de los platos calientes."}]', false, 'Yuzu', '', 'Reforzar robata el sábado', 'Viernes muy lleno, faltó un cocinero en robata.'),
    ('2026-10-31', 'rough', 236, '[{"kind":"complaint","note":"Esperas largas en robata otra vez."},{"kind":"equipment","note":"La máquina de hielo volvió a fallar a las 9pm."}]', false, 'Erizo, toro', 'Valentina y Lucas sacaron la noche adelante', 'Llamar al técnico de la máquina de hielo', ''),
    ('2026-11-01', 'ok', 168, '[]', false, '', 'Sofía en el almuerzo', '', 'Domingo tranquilo.'),
    ('2026-11-02', 'ok', 120, '[{"kind":"allergy","note":"Mesa 12: reacción leve al sésamo en el Ceviche Nikkei. Se avisó a cocina; el cliente está bien."}]', true, '', '', 'Repasar alérgenos de ceviches en el pre-shift', ''),
    ('2026-11-03', 'ok', 131, '[]', false, 'Yuzu', 'Camila con los SA nuevos', '', '')
  ) as x(day, mood, covers, issues, urgent, low, shout, next, notes);
end $$;

commit;
