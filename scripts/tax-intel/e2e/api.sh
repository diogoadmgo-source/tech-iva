A=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
TOK=$(curl -s "http://127.0.0.1:54321/auth/v1/token?grant_type=password" -H "apikey: $A" -H 'content-type: application/json' -d '{"email":"dono@beta.teste","password":"Teste@123456"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
T=3e4bce55-607a-4211-9521-ccc2fe2c66e1
SEL='tenant_id,cnpj,relationship,declared_razao_social,created_at,tax_entities!inner(cnpj_raiz,is_matriz,public_classification)'
q(){ curl -s -o /dev/null -w "%{http_code} %{time_total}s  $1\n" -H "apikey: $A" -H "Authorization: Bearer $TOK" -H "Prefer: count=exact" -H "Range: 0-49" "http://127.0.0.1:54321/rest/v1/$2"; }
q "pagina padrao" "tax_relationships?select=$SEL&tenant_id=eq.$T&order=created_at.desc,cnpj,relationship"
q "busca cnpj" "tax_relationships?select=$SEL&tenant_id=eq.$T&cnpj=like.90012*&order=created_at.desc,cnpj,relationship"
q "busca nome" "tax_relationships?select=$SEL&tenant_id=eq.$T&or=(declared_razao_social.ilike.*Teste%2006999*,declared_nome_fantasia.ilike.*Teste%2006999*)&order=created_at.desc,cnpj,relationship"
q "fornecedor+classe" "tax_relationships?select=$SEL&tenant_id=eq.$T&relationship=eq.fornecedor&tax_entities.public_classification=eq.consulta_pendente&order=created_at.desc,cnpj,relationship"
q "ordem por classe" "tax_relationships?select=$SEL&tenant_id=eq.$T&order=tax_entities(public_classification).asc,cnpj,relationship"
q "count entidades" "tax_entities?select=cnpj,tax_relationships!inner(tenant_id)&tax_relationships.tenant_id=eq.$T&limit=0"
q "count entidades classe" "tax_entities?select=cnpj,tax_relationships!inner(tenant_id)&tax_relationships.tenant_id=eq.$T&public_classification=eq.consulta_pendente&limit=0"
