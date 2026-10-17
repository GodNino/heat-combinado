// trial_ends_at and is_demo arrive with migration 034, organization_id with 035; older databases simply leave them out.
export type Restaurant = { id: string; name: string; owner_id: string; trial_ends_at?: string | null; is_demo?: boolean; organization_id?: string | null };
export type MenuItem = {
  id: string;
  restaurant_id: string;
  name: string;
  description: string;
  ingredients: string[];
  allergens: string[];
  category?: string;
  content_type?: "food" | "cocktails" | "wine";
  price_label?: string | null;
  price?: number | null;
  fire_minutes?: number | null;
  table_setting?: string | null;
  observations?: string | null;
  details?: Record<string, string> | null;
  photo_path: string | null;
  photo_url?: string;
  updated_at?: string;
};
export function listFromText(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
export function validatePhoto(
  file: Pick<File, "size" | "type">,
): string | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return "Choose a JPG, PNG, or WebP photo.";
  if (!file.size) return "This photo is empty. Choose another file.";
  if (file.size > 5 * 1024 * 1024) return "Choose a photo smaller than 5 MB.";
  return null;
}

export function expandCrossContamination(value: string): string {
  return value.replace(/\bCC\b/gi, "cross-contamination");
}
