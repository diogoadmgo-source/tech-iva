-- 0034_fix_seed_user_login.sql
update auth.users
   set confirmation_token   = coalesce(confirmation_token, ''),
       recovery_token       = coalesce(recovery_token, ''),
       email_change_token_new = coalesce(email_change_token_new, ''),
       email_change_token_current = coalesce(email_change_token_current, ''),
       email_change         = coalesce(email_change, ''),
       phone_change         = coalesce(phone_change, ''),
       phone_change_token   = coalesce(phone_change_token, ''),
       reauthentication_token = coalesce(reauthentication_token, '')
 where email in ('admin@fluxa.dev','canal@alfa.dev','dono@beta.dev','fin@beta.dev','viewer@gama.dev');