// Photo links. Menu photos are private, so each one needs a signed link. Links are kept
// in this browser for a few hours: the same link means the browser can reuse the photo
// it already downloaded instead of fetching it again on every visit.
// The photo is served exactly as it was uploaded. HEAT already shrinks every photo in the
// browser before upload (below), so asking Supabase to resize it again saved about 140KB
// and was billed per photo per month -- the one thing on the plan we ever exceeded.
import { supabase } from "@/lib/supabase";

const PHOTO_LINKS_KEY = "heat-photo-links-v1";
const PHOTO_LINK_SECONDS = 6 * 60 * 60;
type PhotoLink = {url: string; until: number};
function readPhotoLinks(): Record<string, PhotoLink> {
  try { return JSON.parse(localStorage.getItem(PHOTO_LINKS_KEY) || "{}") as Record<string, PhotoLink>; } catch { return {}; }
}
export function forgetPhotoLinks() {
  try { localStorage.removeItem(PHOTO_LINKS_KEY); } catch { /* storage unavailable */ }
}
export async function photoLinks(paths: string[]): Promise<Record<string, string>> {
  if (!supabase || !paths.length) return {};
  const now = Date.now();
  const cached = readPhotoLinks();
  const links: Record<string, PhotoLink> = {};
  const missing: string[] = [];
  for (const path of new Set(paths.filter(Boolean))) {
    const link = cached[path];
    if (link && link.until - now > 20 * 60 * 1000) links[path] = link; else missing.push(path);
  }
  if (missing.length) {
    const until = now + PHOTO_LINK_SECONDS * 1000;
    // One request for the whole batch, rather than one per photo as the resized version needed.
    const signed = await supabase.storage.from("menu-photos").createSignedUrls(missing, PHOTO_LINK_SECONDS);
    if (signed.error) throw signed.error;
    for (const link of signed.data ?? []) if (link.path && link.signedUrl) links[link.path] = {url: link.signedUrl, until};
  }
  try { localStorage.setItem(PHOTO_LINKS_KEY, JSON.stringify(links)); } catch { /* storage unavailable */ }
  return Object.fromEntries(Object.entries(links).map(([path, link]) => [path, link.url]));
}
// New photos are shrunk in the browser before upload (longest side 1600 px). If anything
// goes wrong, or the result isn’t smaller, the original file is uploaded unchanged.
export async function shrinkPhoto(file: File): Promise<File> {
  try {
    const image = await createImageBitmap(file, {imageOrientation: "from-image"});
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    const encode = (type: string) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, 0.82));
    let blob = await encode("image/webp");
    if (!blob || blob.type !== "image/webp") blob = await encode("image/jpeg");
    if (!blob || blob.size >= file.size) return file;
    const extension = blob.type === "image/webp" ? "webp" : "jpg";
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + "." + extension, {type: blob.type});
  } catch {
    return file;
  }
}
