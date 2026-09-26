#!/usr/bin/env bash
# Responde uma pergunta só: posso clicar em Publicar no Lovable?
#
# Existe por causa de 16/09/2026: seis correções ficaram gravadas só nesta
# máquina, a publicação subiu a versão antiga, e duas consultas da Receita
# foram gastas rodando um defeito já corrigido.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

falhou=0

echo "1/4 Conferindo o repositório remoto..."
if git fetch origin --quiet; then
  fetch_ok=1
else
  fetch_ok=0
fi

pendentes=""
ignorados=""
while IFS= read -r linha; do
  [ -z "$linha" ] && continue
  status="${linha:0:2}"
  arquivo="${linha:3}"
  if [ "$status" = "??" ]; then
    # arquivo não versionado: sempre conta como pendente
    pendentes="$pendentes$linha"$'\n'
    continue
  fi
  case "$status" in
    *R*|*C*)
      # renomeação/cópia: "$arquivo" seria "antigo -> novo", que não bate
      # com nenhum caminho real — nunca elegível para a isenção de quebra
      # de linha, sempre conta como pendente.
      pendentes="$pendentes$linha"$'\n'
      continue
      ;;
  esac
  # arquivo já versionado e modificado (sem ser renomeação/cópia): se a
  # única diferença é quebra de linha (ex.: src/routeTree.gen.ts é
  # regravado com LF a cada teste), isso não é uma alteração de verdade —
  # ignora.
  if git diff --ignore-cr-at-eol --quiet -- "$arquivo" \
     && git diff --cached --ignore-cr-at-eol --quiet -- "$arquivo"; then
    ignorados="$ignorados  · ignorado (só quebra de linha): $arquivo"$'\n'
  else
    pendentes="$pendentes$linha"$'\n'
  fi
done <<< "$(git status --porcelain)"

if [ -n "$ignorados" ]; then
  printf '%s' "$ignorados"
fi

if [ -n "$pendentes" ]; then
  echo "  ✗ Há alterações nesta máquina que não foram gravadas:"
  printf '%s' "$pendentes" | sed 's/^/      /'
  falhou=1
else
  echo "  ✓ Nada pendente de gravar"
fi

echo "2/4 Conferindo se tudo foi enviado..."
if [ "$fetch_ok" -eq 0 ]; then
  echo "  ✗ Não consegui falar com o GitHub — não dá para garantir que tudo foi enviado."
  falhou=1
else
  a_enviar=$(git rev-list --count origin/main..HEAD)
  a_trazer=$(git rev-list --count HEAD..origin/main)
  if [ "$a_enviar" -gt 0 ]; then
    echo "  ✗ $a_enviar alteração(ões) gravada(s) aqui e NÃO enviada(s)."
    echo "      O Lovable não as vê. Envie com: git push origin main"
    falhou=1
  else
    echo "  ✓ Tudo o que está gravado aqui foi enviado"
  fi
  if [ "$a_trazer" -gt 0 ]; then
    echo "  ✗ O remoto tem $a_trazer alteração(ões) que não estão aqui (provavelmente do Lovable)."
    echo "      Traga com: git pull --no-rebase origin main"
    falhou=1
  fi
fi

echo "3/4 Conferindo os tipos..."
if ./node_modules/.bin/tsc --noEmit -p tsconfig.json; then
  echo "  ✓ Tipos"
else
  echo "  ✗ Erro de tipos"
  falhou=1
fi

echo "4/4 Rodando os testes..."
if ./node_modules/.bin/vitest run >/tmp/pronto-testes.log 2>&1; then
  echo "  ✓ $(grep -E 'Tests ' /tmp/pronto-testes.log | tail -1 | sed 's/^ *//')"
else
  echo "  ✗ Testes falhando:"
  grep -E 'FAIL|Tests ' /tmp/pronto-testes.log | sed 's/^/      /'
  falhou=1
fi

echo
if [ "$falhou" -eq 0 ]; then
  echo "PRONTO PARA PUBLICAR"
else
  echo "NÃO PUBLIQUE AINDA"
  exit 1
fi
