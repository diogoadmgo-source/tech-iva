/**
 * Material sensível de integração (certificado A1, senha, chave de API).
 *
 * REGRAS QUE NÃO PODEM SER QUEBRADAS:
 *  - o material nunca é gravado em tabela, nunca volta ao navegador, nunca vai para log;
 *  - o único identificador que pode aparecer em log é o fingerprint SHA-256;
 *  - o blob cifrado vive em bucket PRIVADO do Storage e não existe rota de download.
 *
 * Cifra: envelope encryption.
 *  1. DEK aleatória de 256 bits cifra o material com AES-256-GCM;
 *  2. a DEK é embrulhada com uma KEK derivada da chave mestra DFE_SECRET_KEY
 *     (HKDF-SHA-256), também em AES-256-GCM;
 *  3. o que sobe para o bucket é um envelope JSON com iv, dek embrulhada e ciphertext.
 *     Sem a chave mestra, o conteúdo do bucket é inútil.
 *  4. o envelope grava o `kid` da chave mestra usada, então a chave pode ser
 *     rotacionada sem invalidar material já cifrado (ver masterKeyRing()).
 */

import forge from "node-forge";

export const SECRETS_BUCKET = "dfe-secrets";

export type PfxMetadata = {
  subjectCn: string | null;
  subjectCnpj: string | null;
  fingerprint: string;
  notBefore: string; // YYYY-MM-DD
  notAfter: string; // YYYY-MM-DD
};

/** Erro de negócio seguro de mostrar ao usuário (nunca contém material). */
export class CredentialError extends Error {}

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * ROTAÇÃO DE CHAVE MESTRA.
 *
 * Cada envelope carrega o identificador da chave usada (`kid`). A cifra sempre
 * usa a chave ATIVA; a decifra resolve a chave pelo `kid` gravado. Assim é
 * possível trocar a chave mestra sem invalidar o que já está cifrado: a antiga
 * continua configurada como chave de leitura até o material ser re-selado.
 *
 * Variáveis:
 *  - DFE_SECRET_KEY            chave ativa (cifra e decifra)
 *  - DFE_SECRET_KEY_ID         kid da chave ativa (padrão "k1")
 *  - DFE_SECRET_KEY_PREVIOUS   chave anterior, somente leitura (opcional)
 *  - DFE_SECRET_KEY_PREVIOUS_ID kid da chave anterior (padrão "k0")
 *
 * Envelopes antigos (v1, sem `kid`) são abertos tentando todas as chaves
 * configuradas, na ordem ativa -> anterior.
 */
type MasterKey = { kid: string; value: string };

function activeMasterKey(): MasterKey {
  const value = process.env["DFE_SECRET_KEY"];
  if (!value) throw new CredentialError("Chave mestra de cifra não configurada no servidor.");
  return { kid: process.env["DFE_SECRET_KEY_ID"] || "k1", value };
}

function masterKeyRing(): MasterKey[] {
  const ring: MasterKey[] = [activeMasterKey()];
  const previous = process.env["DFE_SECRET_KEY_PREVIOUS"];
  if (previous) {
    ring.push({ kid: process.env["DFE_SECRET_KEY_PREVIOUS_ID"] || "k0", value: previous });
  }
  return ring;
}

async function kek(salt: Uint8Array, keyValue: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", enc.encode(keyValue), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as unknown as BufferSource,
      info: enc.encode("techiva:dfe-credential:v1"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}


const b64 = (bytes: ArrayBuffer | Uint8Array) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (const byte of view) out += String.fromCharCode(byte);
  return btoa(out);
};

export function fromBase64(value: string): Uint8Array {
  const clean = value.includes(",") ? (value.split(",").pop() ?? "") : value;
  const raw = atob(clean.replace(/\s/g, ""));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Envelope encryption do material. Devolve o blob que vai para o bucket privado. */
/**
 * Sela material + senha num ÚNICO envelope. Um objeto só no bucket: não existe
 * operação parcial (material gravado sem senha) e não existe "senha ao lado do
 * material" — quem alcança o objeto continua precisando da DFE_SECRET_KEY.
 */
export async function sealCertificateBundle(
  pfx: Uint8Array,
  password: string,
): Promise<Uint8Array> {
  return sealSecret(JSON.stringify({ v: 1, pfx: b64(pfx), password }));
}

export async function sealSecret(plain: Uint8Array | string): Promise<Uint8Array> {
  const material = typeof plain === "string" ? enc.encode(plain) : plain;

  const dekRaw = crypto.getRandomValues(new Uint8Array(32));
  const dek = await crypto.subtle.importKey("raw", dekRaw, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dek, material as never);

  const active = activeMasterKey();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: wrapIv },
    await kek(salt, active.value),
    dekRaw as never,
  );

  const envelope = {
    v: 2,
    kid: active.kid,
    alg: "AES-256-GCM",
    kdf: "HKDF-SHA-256",
    salt: b64(salt),
    wrap_iv: b64(wrapIv),
    dek: b64(wrapped),
    iv: b64(iv),
    ct: b64(ciphertext),
  };
  return enc.encode(JSON.stringify(envelope));
}

type Envelope = {
  v: number;
  kid?: string;
  salt: string;
  wrap_iv: string;
  dek: string;
  iv: string;
  ct: string;
};

/**
 * Abre um envelope. Resolve a chave mestra pelo `kid`; envelopes v1 (sem kid)
 * são tentados com todas as chaves configuradas. Devolve os bytes do conteúdo.
 */
export async function unsealSecret(blob: Uint8Array | string): Promise<Uint8Array> {
  let envelope: Envelope;
  try {
    envelope = JSON.parse(typeof blob === "string" ? blob : dec.decode(blob)) as Envelope;
  } catch {
    throw new CredentialError("Envelope de credencial inválido.");
  }

  const ring = masterKeyRing();
  const matching = envelope.kid ? ring.filter((key) => key.kid === envelope.kid) : ring;
  // O `kid` identifica a chave, mas não deve tornar o envelope irrecuperável se
  // apenas o identificador foi renomeado na configuração. Tenta primeiro a
  // correspondência exata e, depois, as demais chaves configuradas. O material
  // continua protegido: somente uma KEK que autentique o AES-GCM consegue abrir.
  const candidates = [
    ...matching,
    ...ring.filter((key) => !matching.some((candidate) => candidate.kid === key.kid)),
  ];

  const salt = fromBase64(envelope.salt);
  const wrapIv = fromBase64(envelope.wrap_iv);
  const wrappedDek = fromBase64(envelope.dek);
  const iv = fromBase64(envelope.iv);
  const ct = fromBase64(envelope.ct);

  for (const candidate of candidates) {
    try {
      const dekRaw = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: wrapIv as unknown as BufferSource },
        await kek(salt, candidate.value),
        wrappedDek as never,
      );
      const dek = await crypto.subtle.importKey("raw", dekRaw, { name: "AES-GCM" }, false, [
        "decrypt",
      ]);
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, dek, ct as never);
      return new Uint8Array(plain);
    } catch {
      // tenta a próxima chave do anel
    }
  }
  throw new CredentialError(
    "Não foi possível abrir a credencial: nenhuma chave mestra configurada corresponde à usada no cadastro. Cadastre novamente a credencial RTC em Integrações.",
  );
}

/** Re-sela um envelope com a chave ATIVA (rotação sem recadastro do cliente). */
export async function resealSecret(blob: Uint8Array | string): Promise<Uint8Array> {
  return sealSecret(await unsealSecret(blob));
}


/**
 * Abre o .pfx com a senha e extrai os metadados. Senha errada -> erro claro,
 * sem gravar nada. Nada do conteúdo é logado nem devolvido além dos metadados.
 */
export function readPfx(pfx: Uint8Array, password: string): PfxMetadata {
  let cert: forge.pki.Certificate | undefined;
  try {
    let binary = "";
    for (let i = 0; i < pfx.length; i += 8192) {
      binary += String.fromCharCode(...Array.from(pfx.subarray(i, i + 8192)));
    }
    const asn1 = forge.asn1.fromDer(binary);
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
    const certBagOid = forge.pki.oids["certBag"] as string;
    const bags = p12.getBags({ bagType: certBagOid })[certBagOid] ?? [];
    const certs = bags
      .map((bag: forge.pkcs12.Bag) => bag.cert)
      .filter(Boolean) as forge.pki.Certificate[];
    // o certificado do titular é o que não é CA
    cert = certs.find((c) => !c.getExtension("basicConstraints")) ?? certs[0];
  } catch {
    throw new CredentialError(
      "Não foi possível abrir o certificado. Verifique se a senha está correta e se o arquivo é um .pfx/.p12 válido.",
    );
  }
  if (!cert) throw new CredentialError("O arquivo não contém um certificado.");

  const cn = (cert.subject.getField("CN")?.value as string | undefined) ?? null;
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const md = forge.md.sha256.create();
  md.update(der);
  const fingerprint = (md.digest().toHex().match(/.{2}/g) ?? []).join(":").toUpperCase();

  const digits = (cn ?? "").replace(/\D/g, "");
  const cnpj = digits.length >= 14 ? digits.slice(-14) : null;

  return {
    subjectCn: cn,
    subjectCnpj: cnpj,
    fingerprint,
    notBefore: cert.validity.notBefore.toISOString().slice(0, 10),
    notAfter: cert.validity.notAfter.toISOString().slice(0, 10),
  };
}

export function secretPath(tenantId: string, provider: string): string {
  return `secrets/${tenantId}/${provider}/${crypto.randomUUID()}.enc`;
}

export const onlyDigits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

/**
 * Limpeza de órfãos no bucket privado.
 *
 * Um objeto órfão é material cifrado que subiu para o bucket sem registro
 * correspondente em integration_credentials (ex.: o upload gravou o envelope e o
 * register_credential falhou depois). Material sensível sem dono é risco puro:
 * ninguém consegue usar, ninguém consegue revogar, e ele fica lá.
 *
 * A rotina lista recursivamente `secrets/` e remove tudo que não estiver
 * referenciado em secret_ref. Nunca remove objeto referenciado.
 */
type StorageLike = {
  storage: {
    from: (bucket: string) => {
      list: (
        path: string,
        opts?: { limit?: number; offset?: number },
      ) => Promise<{ data: { name: string; id: string | null }[] | null; error: { message: string } | null }>;
      remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
    };
  };
  from: (table: string) => {
    select: (columns: string) => Promise<{
      data: Array<{ secret_ref?: string | null; access_token_ref?: string | null }> | null;
      error: { message: string } | null;
    }>;
  };
};

async function listAll(client: StorageLike, prefix: string): Promise<string[]> {
  const found: string[] = [];
  const bucket = client.storage.from(SECRETS_BUCKET);
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await bucket.list(prefix, { limit: pageSize, offset });
    if (error) throw new Error(error.message);
    const entries = data ?? [];
    for (const entry of entries) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      // id null = "pasta" (prefixo virtual do Storage)
      if (entry.id === null) found.push(...(await listAll(client, full)));
      else found.push(full);
    }
    if (entries.length < pageSize) break;
  }
  return found;
}

export async function cleanupOrphanSecrets(
  client: StorageLike,
  options: { dryRun?: boolean } = {},
): Promise<{ scanned: number; referenced: number; orphans: string[]; removed: string[] }> {
  const objects = await listAll(client, "secrets");
  const { data, error } = await client.from("integration_credentials").select("secret_ref");
  if (error) throw new Error(error.message);
  const { data: rtcTokens, error: rtcError } = await client
    .from("rtc_apuracao")
    .select("access_token_ref");
  if (rtcError) throw new Error(rtcError.message);
  const referenced = new Set([
    ...(data ?? []).map((r) => r.secret_ref).filter(Boolean),
    ...(rtcTokens ?? []).map((r) => r.access_token_ref).filter(Boolean),
  ] as string[]);
  const orphans = objects.filter((path) => !referenced.has(path));

  let removed: string[] = [];
  if (orphans.length > 0 && !options.dryRun) {
    const { error: rmError } = await client.storage.from(SECRETS_BUCKET).remove(orphans);
    if (rmError) throw new Error(rmError.message);
    removed = orphans;
  }
  return { scanned: objects.length, referenced: referenced.size, orphans, removed };
}
