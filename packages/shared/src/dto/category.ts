/**
 * Ticket categories — US-49.
 *
 * Read-only for now. `US-113` owns creating and editing them; this is the list
 * an agent picks from when they categorise a ticket.
 */
import { z } from 'zod';

import { TicketPrioritySchema } from './ticket.js';

export const CategorySchema = z.object({
  id: z.string().uuid(),
  /** Stable machine name. Never shown to a person. */
  slug: z.string(),
  /**
   * Both languages, rather than one resolved server-side.
   *
   * A category name is picked from a list and then rendered on a ticket, and
   * the person doing the picking may not be the person doing the reading. The
   * client knows which locale it is in; the server would only be guessing.
   */
  nameEn: z.string(),
  nameAr: z.string(),
  parentId: z.string().nullable(),
  /**
   * Where a ticket in this category should be worked — US-49, AC4.
   *
   * A routing hint, not a rule: selecting the category moves the ticket's
   * department, and an agent can still move it back.
   */
  departmentId: z.string().nullable(),
  departmentName: z.string().nullable(),
  /** Applied to a new ticket in this category unless the agent says otherwise. */
  defaultPriority: TicketPrioritySchema.nullable(),
  isActive: z.boolean(),
});

export type Category = z.infer<typeof CategorySchema>;
