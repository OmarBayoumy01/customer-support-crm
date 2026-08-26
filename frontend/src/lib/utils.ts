import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merges class names, letting a later one win over an earlier one.
 *
 * Every shadcn/ui component imports this — it is what makes
 * `<Button className="w-full">` actually override the variant's own width
 * instead of both classes landing in the attribute and the cascade deciding by
 * source order.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
