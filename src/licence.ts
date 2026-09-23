/**
 * Licence gating.
 *
 * Activation is online and ONE TIME. Everything after is offline: we verify a
 * signed token locally. If our server disappeared, every paying customer would
 * keep working. See OPS/licence-server/README.md.
 */

export const PUBLIC_KEY_B64U = "4eJyb_pjgjFxTiXBN3cVBZRqduAV_49gE6IPfzZ6DuU";
export const ACTIVATION_URL = "https://licence.sundrykit.dev";
export const PRODUCT_SLUG = "obsidian-calendar-pro";

/** Where a licence key actually comes from. The settings tab links to it. */
export const STORE_URL = "https://thesundrykit.gumroad.com/l/ccole";

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
export async function verifyToken(
  token: string | undefined,
  // Injectable so a test can sign with a throwaway key pair and prove the
  // whole chain works. A gate nobody has watched open is not a gate.
  publicKeyB64u: string = PUBLIC_KEY_B64U,
): Promise<boolean> {
  if (!token || !token.includes(".")) return false;
  // Fail closed only when there is genuinely no key to check against.
  //
  // This line used to compare the constant against a literal copy of itself,
  // on the belief that the constant was a placeholder. It is not - it is the
  // real public key, derived from the signing key the licence server uses. So
  // the guard matched every time and verifyToken ALWAYS returned false. Every
  // customer could pay, activate, and still be told they were on the free
  // tier. See DECISIONS.md D055.
  if (!publicKeyB64u) return false;

  const [body, sig] = token.split(".");
  if (!body || !sig) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw", fromB64u(publicKeyB64u), { name: "Ed25519" }, false, ["verify"]
    );
    const ok = await crypto.subtle.verify(
      "Ed25519", key, fromB64u(sig), new TextEncoder().encode(body)
    );
    if (!ok) return false;

    const claims = JSON.parse(
      new TextDecoder().decode(new Uint8Array(fromB64u(body)))
    ) as { p?: string };
    return claims.p === PRODUCT_SLUG;
  } catch {
    return false;
  }
}

/**
 * How activation talks to the network.
 *
 * Injected rather than imported, for two reasons. Obsidian's review rejects
 * bare `fetch` and asks for its own `requestUrl`, which routes around CORS and
 * behaves on mobile. And this file has to stay importable by plain Node, since
 * its tests compile it and run it without Obsidian anywhere - the repo rule
 * that keeps the licence logic testable at all.
 *
 * So the plugin passes an adapter over `requestUrl`, and the tests pass a fake.
 */
export interface ActivationResponse {
  status: number;
  body: { token?: string; error?: string };
}

export type PostJson = (url: string, body: unknown) => Promise<ActivationResponse>;

/** One-time online activation. */
export async function activate(licenceKey: string, post: PostJson): Promise<ActivationResult> {
  const key = licenceKey.trim();
  if (!key) return { ok: false, message: "Please enter your licence key." };

  let res: ActivationResponse;
  try {
    res = await post(ACTIVATION_URL + "/activate", { key, product: PRODUCT_SLUG });
  } catch {
    // A network failure is NOT an invalid licence. Saying so would be both
    // wrong and the fastest way to make a paying customer angry.
    return { ok: false, message: "Could not reach the activation server. Check your connection and try again — your licence is fine." };
  }

  const body = res.body ?? {};

  if (res.status < 200 || res.status >= 300) {
    if (body.error === "invalid_licence") {
      return { ok: false, message: "That key was not recognised. Check for typos — you can find it in your Gumroad receipt email." };
    }
    return { ok: false, message: "Activation failed. Please try again in a moment." };
  }

  if (!body.token) {
    // A 200 with no token is a server fault, not a bad key. Never tell a
    // paying customer their licence is wrong when it is ours that broke.
    return { ok: false, message: "Activation failed. Please try again in a moment." };
  }

  return { ok: true, token: body.token, message: "Pro activated. Thank you." };
}
