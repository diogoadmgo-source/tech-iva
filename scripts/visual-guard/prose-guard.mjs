// @ts-check
/**
 * Guarda de regressão visual (estática): garante que os textos explicativos
 * do app fiquem dentro dos balões "?" (InfoHint) / popovers / tooltips e nunca
 * voltem a aparecer como parágrafos soltos nas telas.
 *
 * Usado pelo teste scripts/visual-guard/prose-guard.test.ts e pela CLI:
 *   bun scripts/visual-guard/prose-guard.mjs
 */
import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

/** Limite de prosa tolerado fora de um balão de ajuda. */
export const MAX_INLINE_CHARS = 90;
export const MAX_INLINE_WORDS = 14;

/** Componentes/props onde a prosa explicativa PODE viver. */
const ALLOWED_COMPONENTS = new Set([
  "InfoHint",
  "PopoverContent",
  "HoverCardContent",
  "TooltipContent",
  "DialogDescription",
  "AlertDialogDescription",
  "SheetDescription",
  "DrawerDescription",
  "CardDescription",
  "FormDescription",
]);

/** Props que já entregam o texto para dentro do balão "?" / descrições. */
const ALLOWED_ATTRIBUTES = new Set([
  "help",
  "helpTitle",
  "description",
  "hint",
  "tooltip",
  "aria-label",
  "title",
  "placeholder",
  "label",
  "alt",
  "content",
  "emptyMessage",
  "srLabel",
]);

/**
 * Telas de marketing/autenticação: copy longa é o produto ali, não instrução
 * de uso dentro do app.
 */
const EXCLUDED_FILES = new Set(
  [
    "src/routes/index.tsx",
    "src/routes/login.tsx",
    "src/routes/signup.tsx",
    "src/routes/forgot.tsx",
    "src/routes/reset.tsx",
    "src/routes/confirm.tsx",
    "src/routes/mfa.tsx",
    "src/routes/invite.$token.tsx",
    "src/routes/s.$token.tsx",
    "src/routes/design.tsx",
    "src/routes/__root.tsx",
  ].map((p) => p.split("/").join(path.sep)),
);

/** Diretórios varridos (código de produto, não a lib shadcn). */
const SCAN_DIRS = ["src/routes", "src/components/techiva", "src/components/app"];

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (/\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

export function collectFiles(root = process.cwd()) {
  return SCAN_DIRS.flatMap((d) => walkFiles(path.join(root, d))).filter((file) => {
    const rel = path.relative(root, file);
    return !EXCLUDED_FILES.has(rel);
  });
}

function jsxName(node) {
  const tag =
    ts.isJsxElement(node) ? node.openingElement.tagName
    : ts.isJsxSelfClosingElement(node) ? node.tagName
    : undefined;
  if (!tag) return undefined;
  const text = tag.getText();
  return text.includes(".") ? (text.split(".").pop() ?? text) : text;
}

/** Sobe a árvore: a prosa está dentro de um contêiner de ajuda permitido? */
function isInsideAllowedContext(node) {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isJsxAttribute(cur)) {
      const name = cur.name.getText();
      if (ALLOWED_ATTRIBUTES.has(name)) return true;
    }
    if (ts.isJsxElement(cur) || ts.isJsxSelfClosingElement(cur)) {
      const name = jsxName(cur);
      if (name && ALLOWED_COMPONENTS.has(name)) return true;
    }
  }
  return false;
}

function normalize(raw) {
  return raw.replace(/\s+/g, " ").trim();
}

function isProse(text) {
  if (text.length <= MAX_INLINE_CHARS) return false;
  const words = text.split(" ").filter(Boolean);
  if (words.length <= MAX_INLINE_WORDS) return false;
  // Precisa parecer frase (tem letras e espaço), não classe CSS ou id.
  return /[a-zà-ú]/i.test(text) && !/^[\w-]+$/.test(text);
}

/** @returns {{file:string,line:number,text:string}[]} */
export function findLooseProse(root = process.cwd()) {
  const violations = [];
  for (const file of collectFiles(root)) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    const visit = (node) => {
      let raw;
      if (ts.isJsxText(node)) raw = node.text;
      else if (
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
        ts.isJsxExpression(node.parent)
      )
        raw = node.text;

      if (raw !== undefined) {
        const text = normalize(raw);
        if (isProse(text) && !isInsideAllowedContext(node)) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          violations.push({
            file: path.relative(root, file),
            line: line + 1,
            text: text.slice(0, 120),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return violations;
}

if (import.meta.main) {
  const found = findLooseProse();
  if (found.length === 0) {
    console.log("prose-guard: OK — nenhum texto explicativo solto nas telas.");
  } else {
    for (const v of found) console.log(`${v.file}:${v.line} → "${v.text}"`);
    console.log(`\nprose-guard: ${found.length} texto(s) fora do balão "?".`);
    process.exit(1);
  }
}
