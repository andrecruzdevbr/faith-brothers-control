do $$
declare
  v_count integer;
begin
  select count(*)
  into v_count
  from public.billings b
  join public.students s on s.id = b.student_id
  where (
    lower(s.full_name) like '%debora%'
    or lower(s.full_name) like '%débora%'
  )
  and b.reference_month >= date '2026-08-01'
  and b.reference_month < date '2026-09-01'
  and b.boleto_url ilike '%sandbox%';

  if v_count = 0 then
    raise notice 'Nenhuma cobrança sandbox da Debora em agosto/2026 encontrada. Nada foi apagado.';
    return;
  end if;

  if v_count > 1 then
    raise exception 'Segurança: encontrei % cobranças sandbox da Debora em agosto/2026. Não apaguei nada.', v_count;
  end if;

  delete from public.billings b
  using public.students s
  where s.id = b.student_id
  and (
    lower(s.full_name) like '%debora%'
    or lower(s.full_name) like '%débora%'
  )
  and b.reference_month >= date '2026-08-01'
  and b.reference_month < date '2026-09-01'
  and b.boleto_url ilike '%sandbox%';

  raise notice 'Cobrança sandbox da Debora em agosto/2026 apagada com segurança.';
end $$;