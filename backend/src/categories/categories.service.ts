import { Injectable } from '@nestjs/common';
import type { Category } from '@crm/shared';

import { PrismaService } from '../prisma/index.js';

/**
 * The category list an agent picks from — US-49, AC3.
 *
 * Read-only. Creating and editing them is `US-113`, which the MVP scope defers
 * in favour of seeded categories; this is the half the ticket workspace needs.
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every category somebody may still choose.
   *
   * Inactive ones are excluded: a category an administrator has retired should
   * not appear in a picker, and a ticket already in one keeps its name because
   * the ticket carries the name, not the list.
   *
   * Ordered by `sortOrder` then name, which is the order an administrator
   * arranged them in — alphabetical would throw that away.
   */
  async list(): Promise<Category[]> {
    const rows = await this.prisma.notDeleted.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
      select: {
        id: true,
        slug: true,
        nameEn: true,
        nameAr: true,
        parentId: true,
        departmentId: true,
        defaultPriority: true,
        isActive: true,
        department: { select: { nameEn: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      parentId: row.parentId,
      departmentId: row.departmentId,
      departmentName: row.department?.nameEn ?? null,
      defaultPriority: row.defaultPriority,
      isActive: row.isActive,
    }));
  }
}
