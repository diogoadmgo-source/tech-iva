# FLUXA — Fundação (PASSO 1) — SQL aplicado no `fluxa-dev`

Estado atual do projeto `fluxa-dev` (ref `lfufwoirpwlsdmststbr`, `sa-east-1`): aplicadas
`0001`, `0002`, `0003`, `0003b`, `0004`, `0005`, `0005b_audit_row_fix`,
`0005c_harden_internal_functions` e `0006_seed_dev`. 9 tabelas com RLS, 18 políticas,
5 tenants, 5 usuários (senha `Teste@123456`), 4 planos, 1 `rule_version` corrente.
Testes (a)–(f): 16/16 PASS (incluindo MFA `aal1`/`aal2`).

**Não reaplicar nada.** Os arquivos deste diretório espelham o banco.

## Ordem de aplicação

| Arquivo | Conteúdo |
|---|---|
| `migrations/0001_control_plane.sql` | 1.1 — extensões, enums, tabelas, índices, revoke update/delete em `audit_log` |
| `migrations/0002_hierarchy.sql` | 1.2 — `ltree_label`, triggers de `path`/anti-reparent, `auth_scopes`, `in_scope`, `role_in`, `is_platform`, `can_admin` |
| `migrations/0003_rls.sql` | 1.3 — RLS em 9 tabelas + políticas do documento (nenhuma escrita com `true`) |
| `migrations/0003b_grants_searchpath_members.sql` | Correções técnicas gravadas: GRANTs, `search_path = public, extensions`, `tenant_members(p_tenant)` com `in_scope`; trigger `handle_new_user`; gate de MFA (`enforce_mfa` → `MFA required`) |
| `migrations/0004_rpcs.sql` | 1.5 — `invite_user`, `accept_invitation`, `set_member_role`, `remove_member`, `create_tenant`, `move_tenant` (com `enforce_mfa`) |
| `migrations/0005_audit.sql` | 1.6 — `log_audit` + `audit_row` e triggers (já inclui o `0005b_audit_row_fix`) |
| `migrations/0005c_harden_internal_functions.sql` | Endurecimento: revoke de `execute` nas funções internas; `revoke ... all functions from anon` |
| `migrations/0006_seed_dev.sql` | 1.7 — seed dev/staging: 5 usuários (senha `Teste@123456`), árvore FLUXA > Contábil Alfa > Distribuidora Beta > Beta — Filial 02, Serviços Gama sob a platform, 4 planos, assinaturas, 1 `rule_version` com `is_current = true` |
| `tests/acceptance_a_f.sql` | Testes (a)–(f) simulando os 5 usuários via `request.jwt.claims` |

## Notas de fidelidade ao documento

- `0004` chama `log_audit`, criada em `0005`: correto para plpgsql (resolução em runtime), por isso a ordem do documento foi mantida.
- `accept_invitation` usa `declare v invitations` (o documento escreve `v inv record`, que não compila).
- `invite_user` compara papel com `p_role::text like 'platform%'` (o `like` do documento sobre enum não compila).
- `log_audit` pega o primeiro IP de `x-forwarded-for` (o header pode vir com lista, e `inet` rejeitaria).
- `v_tenant_members` é criada em `0003` (fidelidade) e substituída em `0003b` pela função `tenant_members(p_tenant)`, conforme decisão.
- `0005_audit.sql` já traz o conteúdo do `0005b_audit_row_fix` aplicado no banco: `audit_row()` lê as colunas via `jsonb` (`v_row := coalesce(to_jsonb(new), to_jsonb(old))`), porque o plpgsql valida `new.tenant_id` mesmo no ramo não executado do `CASE` e o record de `tenants` não tem essa coluna — o seed quebrava. E `log_audit` lê claims/headers com `nullif(current_setting(...,true),'')::jsonb`, evitando `''::jsonb`.
- `remove_member` também chama `perform enforce_mfa(p_tenant)` logo após o `can_admin`.
- `0005c_harden_internal_functions.sql`: `revoke execute` de `log_audit`, `audit_row`, `handle_new_user`, `tenants_set_path`, `tenants_block_reparent`, `ltree_label`, `enforce_mfa` e `role_requires_mfa` para `public`/`anon`/`authenticated`, mais `revoke execute on all functions in schema public from anon`. Motivo: o advisor do Supabase apontou `log_audit` exposta como RPC — qualquer usuário logado poderia forjar auditoria. `current_aal()` permanece exposta a `authenticated`.
- MFA: `enforce_mfa()` exige `aal2` apenas para `platform_*` e `channel_admin`, nas RPCs `invite_user`, `create_tenant`, `set_member_role` e `move_tenant`; erro exato `MFA required`.

## Como rodar os testes (já executados: 16/16 PASS)

```bash
psql "$DATABASE_URL" -f db/tests/acceptance_a_f.sql
```

Saída: uma linha por teste com `esperado`, `obtido` e `PASS`/`FAIL`, mais o total.

## Correção aplicada em 2026-08-17 (0006b)

O seed 0006 inseriu os 5 usuários em `auth.users` deixando `confirmation_token`,
`recovery_token`, `email_change`, `email_change_token_new/current`, `phone_change`,
`phone_change_token` e `reauthentication_token` como NULL. O GoTrue não consegue
ler essas colunas nulas e o login retornava HTTP 500
`Database error querying schema`. Correção: `update auth.users set <coluna> = ''`
onde estava nulo. Em novos seeds, insira `''` nessas colunas.
