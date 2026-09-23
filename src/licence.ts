/**
 * Licence gating.
 *
 * Activation is online and ONE TIME. Everything after is offline: we verify a
 * signed token locally. If our server disappeared, every paying customer would
 * keep working. See OPS/licence-server/README.md.
 */

export const PUBLIC_KEY_B64U = "4eJyb_pjgjFxTiXBN3cVBZRqduAV_49gE6IPfzZ6DuU";
export const ACTIVATION_URL = "https://bertha-licence.workers.dev";
export const PRODUCT_SLUG = "obsidian-calendar-pro";

/**
 * Decode base64url to a plain ArrayBuffer.
 *
 * Returns ArrayBuffer rather than Uint8Array deliberately: TypeScript 5.7+
 * types Uint8Array as generic over its backing buffer, and WebCrypto will not
 * accept a possibly-SharedArrayBuffer-backed view.
 */
function fromB64u(str: string): ArrayBuffer {
  const pad = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

export interface ActivationResult {
  ok: boolean;
  token?: string;
  /** A message we are willing to show a paying customer. */
  message?: string;
}

/** Verify a stored token offline. Never touches the network. */
export async function verifyToken(token: string | undefined): Promise<boolean> {
  if (!token || !token.includes(".")) return false;
  if (PUBLIC_KEY_B64U === "4eJyb_pjgjFxTiXBN3cVBZRqduAV_49gE6IPfzZ6DuU") return false;

  const [body, sig] = token.split(".");
  if (!body || !sig) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw", fromB64u(PUBLIC_KEY_B64U), { name: "Ed25519" }, false, ["verify"]
    );
    const ok = await crypto.subtle.verify(
      "Ed25519", key, fromB64u(sig), new TextEncoder().encode(body)
    );
    if (!ok) return false;

    const claims = JSON.parse(new TextDecoder().decode(new Uint8Array(fromB64u(body))));
    return claims.p === PRODUCT_SLUG;
  } catch {
    return false;
  }
}

/** One-time online activation. */
export async function activate(licenceKey: string): Promise<ActivationResult> {
  const key = licenceKey.trim();
  if (!key) return { ok: false, message: "Please enter your licence key." };

  let res: Response;
  try {
    res = await fetch(ACTIVATION_URL + "/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, product: PRODUCT_SLUG }),
    });
  } catch {
    // A network failure is NOT an invalid licence. Saying so would be both
    // wrong and the fastest way to make a paying customer angry.
    return { ok: false, message: "Could not reach the activation server. Check your connection and try again — your licence is fine." };
  }

  const data = await res.json().catch(() => ({} as any));

  if (!res.ok) {
    if (data?.error === "invalid_licence") {
      return { ok: false, message: "That key was not recognised. Check for typos — you can find it in your Gumroad receipt email." };
    }
    return { ok: false, message: "Activation failed. Please try again in a moment." };
  }

  return { ok: true, token: data.token, message: "Pro activated. Thank you." };
}
