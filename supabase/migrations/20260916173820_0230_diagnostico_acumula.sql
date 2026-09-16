-- 0230_diagnostico_acumula.sql
--
-- Incidente de 15/09/2026: o download falhou as 20:13 e a linha guardou o
-- porque. Ao reprocessar em 16/09 as 17:03, a nova tentativa SOBRESCREVEU o
-- registro: `download_diag` e uma coluna so, e `chamada_diag` guarda uma
-- entrada por etapa. A falha original — a unica que explicava a perda do
-- tiquete — desapareceu.
--
-- Numa consulta que custa 1 de 2 por dia, o diagnostico tem que acumular.
-- Passa a existir `historico`: lista append-only, em ordem, com cada tentativa.
-- `download_diag` e `chamada_diag` continuam existindo com o mesmo significado
-- de antes (a ULTIMA tentativa), para nao quebrar nada que ja os leia.
--
-- A escrita passa a ser atomica numa funcao. Antes eram SELECT + UPDATE no
-- cliente: duas idas ao banco e, com duas tentativas simultaneas, a segunda
-- apagava a primeira.

alter table public.rtc_apuracao
  add column if not exists historico jsonb;

comment on column public.rtc_apuracao.historico is
  'Lista append-only de todas as tentativas (token, solicitar, download, notas), em ordem. Limitada as 50 ultimas. Nunca carrega credencial, access_token nem URL assinada.';

create or replace function public.rtc_apuracao_registrar_diag(
  p_id      uuid,
  p_destino text,   -- 'download' ou 'chamada'
  p_chave   text,   -- etapa/nota; obrigatorio quando destino = 'chamada'
  p_entrada jsonb
) returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_entrada jsonb;
begin
  if p_destino not in ('download', 'chamada') then
    raise exception 'destino invalido: %', p_destino;
  end if;
  if p_destino = 'chamada' and coalesce(btrim(p_chave), '') = '' then
    raise exception 'chave obrigatoria quando destino = chamada';
  end if;
  if p_entrada is null or jsonb_typeof(p_entrada) <> 'object' then
    raise exception 'entrada precisa ser um objeto jsonb';
  end if;

  -- O que distingue uma entrada da outra no historico. `registrado_em` e do
  -- banco: o `em` que vem de dentro e o instante da resposta da Receita, e os
  -- dois juntos mostram quanto tempo a gravacao demorou.
  v_entrada := p_entrada || jsonb_build_object(
    'destino', p_destino,
    'chave', coalesce(nullif(btrim(p_chave), ''), p_destino),
    'registrado_em', now());

  update public.rtc_apuracao
     set historico = (
           -- Guarda as 50 ultimas, em ordem de chegada. O limite existe porque
           -- a fila de recuperacao pode ser acionada varias vezes; sem ele, uma
           -- linha teimosa cresceria sem fim.
           select jsonb_agg(e order by ord)
             from (
               select e, ord
                 from jsonb_array_elements(
                        coalesce(historico, '[]'::jsonb) || jsonb_build_array(v_entrada)
                      ) with ordinality as t(e, ord)
                order by ord desc
                limit 50
             ) ult
         ),
         download_diag = case when p_destino = 'download'
                              then p_entrada else download_diag end,
         chamada_diag  = case when p_destino = 'chamada'
                              then coalesce(chamada_diag, '{}'::jsonb)
                                   || jsonb_build_object(btrim(p_chave), p_entrada)
                              else chamada_diag end
   where id = p_id;
end
$function$;

revoke all on function public.rtc_apuracao_registrar_diag(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rtc_apuracao_registrar_diag(uuid, text, text, jsonb) to service_role;
