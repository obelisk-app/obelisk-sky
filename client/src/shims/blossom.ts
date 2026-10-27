// @/services/media/blossom with sky's signer instead of the app's bridge:
// same SDK, same servers (src/constants/media/blossom.ts).

import { uploadToBlossom as uploadBlob } from '@nostr-wot/blossom';
import { PrivateKeySigner } from '@nostr-wot/signers';
import { BLOSSOM_SERVERS } from '@/constants/media/blossom';
import { getHost } from './host';

export { BlossomUploadError } from '@nostr-wot/blossom';

type Sign = ReturnType<typeof getHost>['sign'];

/** Upload under `secretKey` (a new account's), else with `sign`, else sky's session signer. */
export async function uploadToBlossom(file: File, secretKey?: Uint8Array, sign?: Sign): Promise<string> {
  const signer = secretKey ? new PrivateKeySigner(secretKey) : { signEvent: (t: Parameters<Sign>[0]) => (sign ? sign(t) : getHost().sign(t)) };
  const blob = await uploadBlob(file, {
    signer: signer as never,
    servers: BLOSSOM_SERVERS,
    contentType: file.type || 'application/octet-stream',
  });
  return blob.url;
}
