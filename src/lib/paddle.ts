import { useCallback, useState } from "react";

import { resolvePaddlePrice } from "@/lib/payments.functions";

const clientToken = import.meta.env["VITE_PAYMENTS_CLIENT_TOKEN"] as string | undefined;

declare global {
  interface Window {
    Paddle: {
      Environment: { set: (env: string) => void };
      Initialize: (opts: { token: string }) => void;
      Checkout: { open: (opts: Record<string, unknown>) => void };
    };
  }
}

/** Única fonte de verdade do ambiente no cliente (derivada do prefixo do token). */
export function getPaddleEnvironment(): "sandbox" | "live" {
  return clientToken?.startsWith("test_") ? "sandbox" : "live";
}

let initialized = false;
let loading: Promise<void> | null = null;

export function initializePaddle(): Promise<void> {
  if (initialized) return Promise.resolve();
  if (loading) return loading;
  if (!clientToken) return Promise.reject(new Error("Pagamentos não configurados neste projeto."));

  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.onload = () => {
      window.Paddle.Environment.set(
        getPaddleEnvironment() === "sandbox" ? "sandbox" : "production",
      );
      window.Paddle.Initialize({ token: clientToken });
      initialized = true;
      resolve();
    };
    script.onerror = () => reject(new Error("Não foi possível carregar o checkout."));
    document.head.appendChild(script);
  });
  return loading;
}

export async function getPaddlePriceId(priceId: string): Promise<string> {
  return resolvePaddlePrice({ data: { priceId, environment: getPaddleEnvironment() } });
}

export type CheckoutOptions = {
  priceId: string;
  customerEmail?: string | undefined;
  customData?: Record<string, string> | undefined;
  successUrl?: string | undefined;
};

export function usePaddleCheckout() {
  const [loadingCheckout, setLoadingCheckout] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCheckout = useCallback(async (options: CheckoutOptions) => {
    setLoadingCheckout(true);
    setError(null);
    try {
      await initializePaddle();
      const paddlePriceId = await getPaddlePriceId(options.priceId);
      window.Paddle.Checkout.open({
        items: [{ priceId: paddlePriceId, quantity: 1 }],
        ...(options.customerEmail ? { customer: { email: options.customerEmail } } : {}),
        ...(options.customData ? { customData: options.customData } : {}),
        settings: {
          displayMode: "overlay",
          variant: "one-page",
          allowLogout: false,
          successUrl: options.successUrl ?? `${window.location.origin}/`,
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao abrir o checkout.");
      throw e;
    } finally {
      setLoadingCheckout(false);
    }
  }, []);

  return { openCheckout, loading: loadingCheckout, error };
}
