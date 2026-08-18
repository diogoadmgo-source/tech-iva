-- Remove a versão antiga de register_credential: com duas versões coexistindo,
-- qualquer chamada com os 10 parâmetros originais fica AMBÍGUA e falha em runtime.
drop function if exists public.register_credential(uuid, text, credential_kind, text, text, text, text, date, date, text[]);