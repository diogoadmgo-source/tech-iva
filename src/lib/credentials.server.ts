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
 *     Sem a DFE_SECRET_KEY, o conteúdo do bucket é inútil.
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

function masterKey(): string {
  const key = process.env["DFE_SECRET_KEY"];
  if (!key) throw new CredentialError("Chave mestra de cifra não configurada no servidor.");
  return key;
}

async function kek(salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", enc.encode(masterKey()), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: enc.encode("techiva:dfe-credential:v1") },
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
export async function sealSecret(plain: Uint8Array | string): Promise<Uint8Array> {
  const material = typeof plain === "string" ? enc.encode(plain) : plain;

  const dekRaw = crypto.getRandomValues(new Uint8Array(32));
  const dek = await crypto.subtle.importKey("raw", dekRaw, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dek, material as never);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: wrapIv },
    await kek(salt),
    dekRaw as never,
  );

  const envelope = {
    v: 1,
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

/**
 * Abre o .pfx com a senha e extrai os metadados. Senha errada -> erro claro,
 * sem gravar nada. Nada do conteúdo é logado nem devolvido além dos metadados.
 */
export function readPfx(pfx: Uint8Array, password: string): PfxMetadata {
  let cert: forge.pki.Certificate | undefined;
  try {
    const binary = String.fromCharCode(...Array.from(pfx));
    const asn1 = forge.asn1.fromDer(binary);
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
    const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
    const certs = bags.map((bag) => bag.cert).filter(Boolean) as forge.pki.Certificate[];
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
