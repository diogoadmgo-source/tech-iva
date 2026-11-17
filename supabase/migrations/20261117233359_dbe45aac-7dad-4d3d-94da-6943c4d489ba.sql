drop policy if exists tax_sources_read on public.tax_sources;
create policy tax_sources_read on public.tax_sources
  for select to authenticated using (public.has_any_membership());