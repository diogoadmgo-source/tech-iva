-- limpeza: remove o fator TOTP criado durante o teste automatizado de MFA
delete from auth.mfa_factors;