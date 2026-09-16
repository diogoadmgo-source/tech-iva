-- Registra a versão REAL do motor oficial importado em 19/08/2026 (dados-abertos/versao do componente offline):
--   versaoApp 1.3.0 · versaoDb V0042 ("Atualiza a tabela CLASSIF_NBS_INDOP_LC aplicando as vigências definidas na tabela do anexo VII", 2026-07-07)
-- Identidade usada em env RTC_CALC_VERSION, tag Docker techiva/rtc-calc e rule_versions.calc_version: 1.3.0-dbV0042
-- A seed "2026.08.0" deixa de ser corrente; nenhum item foi calculado por ela com motor real (calc_memory.rule_version) — mantém-se para histórico.
update rule_versions set is_current = false where is_current;
insert into rule_versions (calc_version, cclasstrib_version, valid_from, published_at, notes, is_current)
values ('1.3.0-dbV0042', 'V0042', date '2026-07-07', now(),
        'Calculadora de Tributos RFB — componente offline: versaoApp 1.3.0, versaoDb V0042 (anexo VII / CLASSIF_NBS_INDOP_LC), dataVersaoDb 2026-07-07. Importado em 19/08/2026.',
        true)
on conflict do nothing;
select calc_version, is_current from rule_versions order by valid_from desc;
