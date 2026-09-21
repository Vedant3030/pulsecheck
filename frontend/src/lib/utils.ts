import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn helper — merges Tailwind classes, deduplicating conflicts.
 * e.g. cn("px-2 bg-red-500", "px-4") => "bg-red-500 px-4"
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
