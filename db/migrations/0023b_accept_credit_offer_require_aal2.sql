-- 0023b_accept_credit_offer_require_aal2.sql
-- APLICADA por esta sessão.
-- Substitui a checagem manual de aal2 dentro de accept_credit_offer por
-- `perform require_aal2();` (helper do 0023), garantindo uma única
-- implementação da regra de MFA no projeto. Mensagem mantida: 'MFA required'.
-- Nada mais do corpo da função foi alterado.

create or replace function public.accept_credit_offer(p_offer uuid, p_signature_ref text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  o record; v_contract uuid; v_total bigint; v_installment bigint; i int; v_due date;
begin
  select * into o from credit.offers where id = p_offer for update;
  if o.id is null then raise exception 'offer not found'; end if;
  if not can_credit(o.tenant_id) then raise exception 'forbidden'; end if;
  perform require_aal2();
  if o.status <> 'pending' then raise exception 'offer no longer available'; end if;
  if o.expires_at < now() then raise exception 'offer expired'; end if;
  if coalesce(nullif(trim(p_signature_ref), ''), '') = '' then raise exception 'signature required'; end if;

  v_total := o.net_amount_cents + o.total_cost_cents;
  v_installment := ceil(v_total::numeric / greatest(o.term_months, 1));

  insert into credit.contracts (
    tenant_id, offer_id, kind, principal_cents, net_disbursed_cents, total_due_cents,
    term_months, monthly_rate_pct, cet_pct, signature_ref, signed_by)
  values (
    o.tenant_id, o.id, o.kind, o.amount_cents, o.net_amount_cents, v_total,
    greatest(o.term_months, 1), o.monthly_rate_pct, o.cet_pct, trim(p_signature_ref), auth.uid())
  returning id into v_contract;

  update credit.offers set status = 'accepted' where id = o.id;

  insert into credit.ledger (contract_id, tenant_id, entry_date, kind, amount_cents, memo)
  values (v_contract, o.tenant_id, current_date, 'disbursement', o.net_amount_cents, 'Liberação do recurso');
  if o.total_cost_cents > 0 then
    insert into credit.ledger (contract_id, tenant_id, entry_date, kind, amount_cents, memo)
    values (v_contract, o.tenant_id, current_date,
            case when o.kind = 'credit_advance' then 'fee' else 'interest' end,
            o.total_cost_cents,
            case when o.kind = 'credit_advance' then 'Deságio da antecipação' else 'Custo financeiro do período' end);
  end if;

  -- entrada de caixa hoje
  perform ensure_tce_partition(current_date);
  insert into tax_cash_events (tenant_id, event_date, kind, amount_cents, ref_contract_id, confidence)
  values (o.tenant_id, current_date, 'loan_in', o.net_amount_cents, v_contract, 1.00);

  -- parcelas e saídas de caixa futuras
  for i in 1 .. greatest(o.term_months, 1) loop
    v_due := (current_date + (i || ' month')::interval)::date;
    insert into credit.repayments (contract_id, tenant_id, installment, due_date, amount_cents)
    values (v_contract, o.tenant_id, i, v_due, v_installment);
    perform ensure_tce_partition(v_due);
    insert into tax_cash_events (tenant_id, event_date, kind, amount_cents, ref_contract_id, confidence)
    values (o.tenant_id, v_due, 'loan_out', v_installment, v_contract, 1.00);
  end loop;

  perform log_audit(o.tenant_id, 'credit.accept', 'credit_contract', v_contract::text, null,
                    jsonb_build_object('offer_id', o.id, 'kind', o.kind,
                                       'net_amount_cents', o.net_amount_cents,
                                       'total_due_cents', v_total,
                                       'term_months', greatest(o.term_months,1),
                                       'cet_pct', o.cet_pct,
                                       'signature_ref', trim(p_signature_ref)));
  return v_contract;
end $$;

revoke execute on function public.accept_credit_offer(uuid, text) from public, anon;
grant execute on function public.accept_credit_offer(uuid, text) to authenticated;
