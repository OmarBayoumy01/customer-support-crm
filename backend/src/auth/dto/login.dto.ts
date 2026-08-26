import { LoginRequestSchema, LoginResponseSchema } from '@crm/shared';

import { createZodDto } from '../../common/index.js';

/**
 * The login body.
 *
 * Wraps the **shared** schema rather than restating it, so the rules the
 * browser validates against and the rules the server enforces are the same
 * object — including the email normalisation the brute-force counter depends
 * on.
 */
export class LoginRequestDto extends createZodDto(LoginRequestSchema) {}

/** Present so US-8's generator can document the response shape. */
export class LoginResponseDto extends createZodDto(LoginResponseSchema) {}
