// Patchwork Lite — identity module
// P-256 keypairs, signing, verifying, base64 + canonical JSON helpers.

import {
  generateKeyPairSync,
  createSign,
  createVerify,
  createPublicKey,
  KeyObject,
} from "node:crypto";
import { canonical } from "../../../shared/protocol.ts";

export interface Identity {
  publicId: string;
  signPrivate: KeyObject;
  ecdhPrivate: KeyObject;
  ecdhPublic: string;
}

export function generateIdentity(): Identity {
  const signPair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const ecdhPair = generateKeyPairSync("ec", { namedCurve: "P-256" });

  const publicId = signPair.publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64");

  const ecdhPublic = ecdhPair.publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64");

  return {
    publicId,
    signPrivate: signPair.privateKey,
    ecdhPrivate: ecdhPair.privateKey,
    ecdhPublic,
  };
}

export function sign(privateKey: KeyObject, message: string): string {
  const signer = createSign("SHA256");
  signer.update(message);
  signer.end();
  return signer.sign(privateKey).toString("base64");
}

export function verify(
  publicIdBase64: string,
  message: string,
  signatureBase64: string,
): boolean {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(publicIdBase64, "base64"),
      format: "der",
      type: "spki",
    });
    const verifier = createVerify("SHA256");
    verifier.update(message);
    verifier.end();
    return verifier.verify(publicKey, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

export { canonical };

export function signObject(
  privateKey: KeyObject,
  obj: Record<string, unknown>,
): { payload: string; sig: string } {
  const payload = canonical(obj);
  const sig = sign(privateKey, payload);
  return { payload, sig };
}

export function verifyObject(
  publicIdBase64: string,
  obj: Record<string, unknown>,
  signatureBase64: string,
): boolean {
  return verify(publicIdBase64, canonical(obj), signatureBase64);
}
