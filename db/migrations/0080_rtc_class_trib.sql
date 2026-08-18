-- 0080_rtc_class_trib.sql — ESPELHO da migration já aplicada no banco pelo time.
-- Matriz CST × cClassTrib da Plataforma CBS (Manual RFB, maio/2026) + validação inline.
-- Dado público e normativo: leitura para qualquer authenticated, escrita só service_role.

create table if not exists public.rtc_class_trib (
  cst              text not null,
  cclasstrib       text not null,
  descricao        text,
  efeito           text,                 -- tributado | reduzido | isento | imune | diferido | monofasico
  reducao_pct      numeric(6,3) not null default 0,
  permite_credito  boolean not null default true,
  base_legal       text,
  vigencia_inicio  date,
  vigencia_fim     date,
  fonte            text,
  atualizado_em    timestamptz not null default now(),
  primary key (cst, cclasstrib)
);

grant select on public.rtc_class_trib to authenticated;
grant all on public.rtc_class_trib to service_role;

alter table public.rtc_class_trib enable row level security;

drop policy if exists rtc_ct_select on public.rtc_class_trib;
create policy rtc_ct_select on public.rtc_class_trib
  for select to authenticated using (true);

-- Valida a combinação e devolve efeito, redução, direito a crédito e base legal.
-- Quando inválida, devolve o motivo e as combinações válidas daquele CST.
create or replace function public.validate_class_trib(
  p_cst text, p_cclasstrib text, p_data date default current_date
) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare v rtc_class_trib;
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  select * into v from rtc_class_trib
   where cst = p_cst and cclasstrib = p_cclasstrib
     and (vigencia_inicio is null or vigencia_inicio <= p_data)
     and (vigencia_fim is null or vigencia_fim >= p_data);

  if v.cst is null then
    return jsonb_build_object('valida', false,
      'motivo', 'Combinação CST '||p_cst||' × cClassTrib '||p_cclasstrib||' não encontrada ou fora de vigência',
      'sugestoes', (select coalesce(jsonb_agg(jsonb_build_object('cclasstrib', c.cclasstrib, 'descricao', c.descricao)), '[]'::jsonb)
                    from rtc_class_trib c where c.cst = p_cst
                      and (c.vigencia_fim is null or c.vigencia_fim >= p_data) limit 10));
  end if;

  return jsonb_build_object('valida', true, 'efeito', v.efeito, 'reducao_pct', v.reducao_pct,
                            'permite_credito', v.permite_credito, 'base_legal', v.base_legal,
                            'descricao', v.descricao);
end $$;

revoke all on function public.validate_class_trib(text, text, date) from public;
grant execute on function public.validate_class_trib(text, text, date) to authenticated;

-- Carga a partir dos dados abertos da Receita (só service_role).
create or replace function public.rtc_class_trib_upsert(p jsonb)
returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare n int := 0; r jsonb;
begin
  for r in select * from jsonb_array_elements(p) loop
    insert into rtc_class_trib (cst, cclasstrib, descricao, efeito, reducao_pct,
                                permite_credito, base_legal, vigencia_inicio, vigencia_fim, atualizado_em)
    values (r->>'cst', r->>'cclasstrib', r->>'descricao', r->>'efeito',
            (r->>'reducao_pct')::numeric, (r->>'permite_credito')::boolean, r->>'base_legal',
            (r->>'vigencia_inicio')::date, (r->>'vigencia_fim')::date, now())
    on conflict (cst, cclasstrib) do update set
      descricao=excluded.descricao, efeito=excluded.efeito, reducao_pct=excluded.reducao_pct,
      permite_credito=excluded.permite_credito, base_legal=excluded.base_legal,
      vigencia_inicio=excluded.vigencia_inicio, vigencia_fim=excluded.vigencia_fim,
      atualizado_em=now();
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.rtc_class_trib_upsert(jsonb) from public;
grant execute on function public.rtc_class_trib_upsert(jsonb) to service_role;
