/**
 * Fundo do ambiente público (landing e auth).
 * Uma única camada de movimento: a aurora lenta aplicada por `.ambient::after`.
 * A malha de linhas, os feixes e as partículas foram removidos de propósito —
 * quando tudo se mexe sempre, nada se destaca.
 */
export function AmbientBackdrop() {
  return <div aria-hidden className="auth-backdrop" />;
}
