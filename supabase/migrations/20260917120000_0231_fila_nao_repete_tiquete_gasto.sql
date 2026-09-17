-- 0231_fila_nao_repete_tiquete_gasto.sql
--
-- Conserta uma premissa errada da 0229, minha.
--
-- A 0229 fez a fila enxergar linha em `status = 'erro'` para que uma falha no
-- download pudesse ser recuperada. A premissa era que o tiquete sobrevive a uma
-- tentativa falha. NAO sobrevive: o manual diz "um unico acesso por tiquete"
-- (Passo 3), e a prova chegou em 16/09 — a linha de 15/09 20:13, que nunca
-- baixou nada, levou 401 com o corpo "Tiquete inexistente ou download ja
-- realizado."
--
-- Resultado: essa linha ficou na fila repetindo um tiquete morto.
--
-- A regra passa a distinguir ONDE a falha aconteceu:
--
--   * Falhou ANTES de chamar o download (token, credencial, rede sem resposta)
--     -> o tiquete nao foi tocado -> repetir e valido.
--   * O endpoint de download RESPONDEU (qualquer status) -> o unico acesso foi
--     gasto -> repetir so gera 401.
--
-- Quem separa os dois e `download_diag`: ele so e gravado quando a Receita
-- respondeu ao download. Sem resposta (timeout, DNS, conexao cortada) ele fica
-- nulo, e a linha continua elegivel.
--
-- A duvida joga a favor de repetir, de proposito. As duas formas de errar nao
-- custam igual:
--   repetir tiquete gasto  -> perde 1 das 8 tentativas de download do dia;
--   nao repetir tiquete bom -> perde 1 das 2 consultas do dia.
-- Por isso a barreira exige PROVA de que o tiquete foi gasto, nao suspeita.
--
-- A URL assinada da v2 e outra coisa: vale 48 h e pode ser usada mais de uma
-- vez. Linha com URL assinada continua elegivel mesmo depois de um download que
-- respondeu — quem limita ali e o prazo, nao o numero de acessos.
--
-- `create or replace` basta: a lista de colunas devolvidas nao muda, entao os
-- grants (service_role) ficam como estao.

create or replace function public.rtc_apuracao_pendentes_download()
returns table (id uuid, tenant_id uuid, cnpj text, competencia date, tiquete text)
language sql
security definer
set search_path to 'public', 'extensions'
as $function$
  select a.id, a.tenant_id, t.cnpj, a.competencia, a.tiquete_download
    from public.rtc_apuracao a
    join public.tenants t on t.id = a.tenant_id
   where a.status in ('tiquete_recebido', 'erro')
     -- v1 (tiquete) ou v2 (URL assinada): basta ter por onde baixar.
     and (a.tiquete_download is not null or a.url_assinada is not null)
     -- Se ja existe payload, o download ja aconteceu; rebaixar nao ajudaria.
     and a.payload is null
     -- O tiquete da v1 tem UM acesso. `download_diag` preenchido prova que o
     -- endpoint de download respondeu, ou seja, que o acesso foi gasto. A URL
     -- assinada da v2 nao tem esse limite e nao entra nesta barreira.
     and (a.url_assinada is not null or a.download_diag is null)
     -- 48 h, a validade da URL assinada, contadas do retorno — ou da abertura,
     -- quando o retorno nao veio por webhook.
     and coalesce(a.webhook_recebido_em, a.solicitado_em) > now() - interval '48 hours'
     -- `a.id` desempata: sem ele, linhas do mesmo instante saem em ordem
     -- indefinida, que pode mudar de execucao para execucao.
   order by coalesce(a.webhook_recebido_em, a.solicitado_em), a.id;
$function$;
