export type PageType = "standard" | "landing" | "legal" | "system";

export const PAGE_TYPES: readonly PageType[] = [
  "standard",
  "landing",
  "legal",
  "system"
];

export function isPageType(value: unknown): value is PageType {
  return typeof value === "string" && (PAGE_TYPES as string[]).includes(value);
}
