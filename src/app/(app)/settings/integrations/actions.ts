"use server";

import { createClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/encryption";
import { z } from "zod";

const apiKeySchema = z.object({
  service: z.literal("serper"),
  key: z.string().min(1).max(200),
});

export async function saveApiKey(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const parsed = apiKeySchema.safeParse({
    service: formData.get("service"),
    key: formData.get("key"),
  });
  if (!parsed.success) throw new Error("Invalid input");

  const encrypted = encrypt(parsed.data.key);

  await supabase
    .from("api_keys")
    .upsert(
      {
        user_id: user.id,
        service: parsed.data.service,
        encrypted_key: encrypted,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,service" }
    );
}

export async function deleteApiKey(service: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  await supabase
    .from("api_keys")
    .delete()
    .eq("user_id", user.id)
    .eq("service", service);
}

export async function getApiKeyStatus(service: string): Promise<{ configured: boolean; lastChars: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data } = await supabase
    .from("api_keys")
    .select("encrypted_key")
    .eq("user_id", user.id)
    .eq("service", service)
    .single();

  if (!data) return { configured: false, lastChars: "" };

  const decrypted = decrypt(data.encrypted_key);
  const lastChars = decrypted.slice(-4);
  return { configured: true, lastChars };
}
