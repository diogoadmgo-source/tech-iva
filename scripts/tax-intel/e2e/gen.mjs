// Base SINTÉTICA para teste local da interface (Supabase local). Nunca usar em produção.
import ExcelJS from "exceljs";
const W = [6,5,4,3,2,9,8,7,6,5,4,3,2];
const val = (c) => c.charCodeAt(0) - 48;
function dv(b){ const w=W.slice(13-b.length); let s=0; for(let i=0;i<b.length;i++) s+=val(b[i])*w[i]; const r=s%11; return r<2?0:11-r; }
const mk = (b12) => { const d1=dv(b12); const d2=dv(b12+d1); return b12+d1+d2; };
const N = +(process.argv[2]||5000), out = process.argv[3];
const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Base");
ws.addRow(["CNPJ","Razão Social","Nome Fantasia","Tipo"]);
let made=0;
for (let i=1;i<=N;i++){
  const root = String(90000000 + Math.floor(i/3)).padStart(8,"0");
  const ordem = String((i%3)+1).padStart(4,"0");
  let c = mk(root+ordem);
  const tipo = i%5===0 ? "Fornecedor" : i%7===0 ? "" : "Cliente";
  let cell = c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,"$1.$2.$3/$4-$5");
  if (i%97===0) cell = c.slice(0,13) + ((+c[13]+1)%10);       // DV errado
  if (i%211===0) cell = "";                                      // vazio
  if (i%101===0) cell = String(Number(c.slice(0,13)))+c.slice(13); // tudo sem zeros? (raiz 9xxxx não tem zero à esq.)
  if (i%150===0) { const a = "12ABC" + String(i).padStart(3,"0") + "0001"; cell = mk(a); }      // alfanumérico
  ws.addRow([cell, `Empresa Teste ${String(i).padStart(5,"0")} Ltda`, i%4===0?`Teste ${i}`:null, tipo]);
  made++;
}
// duplicadas
for (let i=1;i<=40;i++){ const root=String(90000000+i).padStart(8,"0"); ws.addRow([mk(root+"0002"),`Empresa Teste duplicada ${i}`,null,"Cliente"]); }
// zeros à esquerda perdidos (numérico)
for (let i=1;i<=15;i++){ const c=mk("00"+String(123450+i)+"0001"); ws.addRow([Number(c),`Empresa Zero ${i}`,null,"Fornecedor"]); }
await wb.xlsx.writeFile(out);
console.log("linhas", made+55, out);
