import { createClient } from "@supabase/supabase-js";

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "";
const key  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/* Single browser-side client — exported for use in upload components.
   The anon key only reaches what RLS allows; keep the bucket policy to
   INSERT-only for the authenticated service role, or use a signed URL
   strategy if you want tighter control later. */
export const supabase = createClient(url, key);

/** Upload a file to the dastaan-media bucket and return its public URL.
 *  Throws if the upload fails or Supabase is not configured. */
export async function uploadMedia(
  file: File,
  folder: "videos" | "photos"
): Promise<string> {
  if (!url || !key) throw new Error("Supabase is not configured — add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local");

  /* Unique path: folder/timestamp-originalname avoids collisions */
  const ext  = file.name.split(".").pop() ?? "bin";
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage
    .from("dastaan-media")
    .upload(path, file, { upsert: false, contentType: file.type });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from("dastaan-media").getPublicUrl(path);
  return data.publicUrl;
}
