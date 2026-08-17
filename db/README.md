# FLUXA — Fundação (PASSO 1) — SQL preparado, NÃO aplicado

Nada foi executado no banco. Os arquivos abaixo estão prontos para aplicar no projeto
Supabase externo (`fluxa-dev`) assim que a conexão/ref chegar.

## Ordem de aplicação

| Arquivo | Conteúdo |
|---|---|
| `migrations/0001_control_plane.sql` | 1.1 — extensões, enums, tabelas, índices, revoke update/delete em `audit_log` |
| `migrations/0002_hierarchy.sql` | 1.2 — `ltree_label`, triggers de `path`/anti-reparent, `auth_scopes`, `in_scope`, `role_in`, `is_platform`, `can_admin` |
| `migrations/0003_rls.sql` | 1.3 — RLS em 9 tabelas + políticas do documento (nenhuma escrita com `true`) |
| `migrations/0003b_grants_searchpath_members.sql` | Correções técnicas gravadas: GRANTs, `search_path = public, extensions`, `tenant_members(p_tenant)` com `in_scope`; trigger `handle_new_user`; gate de MFA (`enforce_mfa` → `MFA required`) |
| `migrations/0004_rpcs.sql` | 1.5 — `invite_user`, `accept_invitation`, `set_member_role`, `remove_member`, `create_tenant`, `move_tenant` (com `enforce_mfa`) |
| `migrations/0005_audit.sql` | 1.6 — `log_audit` + `audit_row` e triggers |
| `migrations/0006_seed_dev.sql` | 1.7 — seed dev/staging: 5 usuários (senha `Teste@123456`), árvore FLUXA > Contábil Alfa > Distribuidora Beta > Beta — Filial 02, Serviços Gama sob a platform, 4 planos, assinaturas, 1 `rule_version` com `is_current = true` |
| `tests/acceptance_a_f.sql` | Testes (a)–(f) simulando os 5 usuários via `request.jwt.claims` |

## Notas de fidelidade ao documento

- `0004` chama `log_audit`, criada em `0005`: correto para plpgsql (resolução em runtime), por isso a ordem do documento foi mantida.
- `accept_invitation` usa `declare v invitations` (o documento escreve `v inv record`, que não compila).
- `invite_user` compara papel com `p_role::text like 'platform%'` (o `like` do documento sobre enum não compila).
- `log_audit` pega o primeiro IP de `x-forwarded-for` (o header pode vir com lista, e `inet` rejeitaria).
- `v_tenant_members` é criada em `0003` (fidelidade) e substituída em `0003b` pela função `tenant_members(p_tenant)`, conforme decisão.
- MFA: `enforce_mfa()` exige `aal2` apenas para `platform_*` e `channel_admin`, nas RPCs `invite_user`, `create_tenant`, `set_member_role` e `move_tenant`; erro exato `MFA required`.

## Como rodar os testes (depois de aplicar)

```bash
psql "$DATABASE_URL" -f db/tests/acceptance_a_f.sql
```

Saída: uma linha por teste com `esperado`, `obtido` e `PASS`/`FAIL`, mais o total.
