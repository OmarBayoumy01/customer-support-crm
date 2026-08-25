import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const NO_ENVELOPE = 'crm:no-envelope';

/**
 * Opts a route out of the `{ data: ... }` success envelope.
 *
 * For responses whose shape is not ours to choose — a file download, a webhook
 * answering in a provider's format, anything a third party parses. Reach for it
 * rarely: the envelope is what lets the frontend treat every endpoint alike.
 */
export function NoEnvelope(): CustomDecorator<string> {
  return SetMetadata(NO_ENVELOPE, true);
}
