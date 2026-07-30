do $$
declare
  v_count integer;
begin
  select count(*)
  into v_count
  from public.students
  where id::text like '038b8f31%'
  and lower(full_name) like '%debora%';

  if v_count = 0 then
    raise exception 'Segurança: não encontrei a aluna Debora com id iniciado em 038b8f31.';
  end if;

  if v_count > 1 then
    raise exception 'Segurança: encontrei mais de uma Debora com id iniciado em 038b8f31.';
  end if;

  update public.students
  set asaas_customer_id = null
  where id::text like '038b8f31%'
  and lower(full_name) like '%debora%';

  raise notice 'asaas_customer_id antigo da Debora foi limpo. O próximo boleto criará cliente novo no Asaas Produção.';
end $$;