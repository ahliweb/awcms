// supabase/functions/content-transform/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-tenant-id, content-type",
  "Content-Type": "application/json",
};

serve(async (req) => {
  // Step 1: CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Step 2: Method validation
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: corsHeaders },
    );
  }

  // Step 3: Environment setup
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ?? "";
  const secretKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? "";

  // Step 4: Authenticate caller using publishable key client
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData?.user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: corsHeaders },
    );
  }

  // Step 5: Validate tenant context
  const tenantId = req.headers.get("x-tenant-id") ?? "";
  if (!tenantId) {
    return new Response(
      JSON.stringify({ error: "Missing x-tenant-id header" }),
      { status: 400, headers: corsHeaders },
    );
  }

  // Step 6: Create admin client for privileged operations
  const adminClient = createClient(supabaseUrl, secretKey);

  // Step 7: Parse and validate request payload
  const payload = await req.json();
  if (!payload?.blog_id || !payload?.transformed) {
    return new Response(
      JSON.stringify({ error: "Missing blog_id or transformed content" }),
      { status: 400, headers: corsHeaders },
    );
  }

  // Step 8: Perform tenant-scoped business logic
  const { data, error } = await adminClient
    .from("blogs")
    .update({
      content: payload.transformed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payload.blog_id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .select("id")
    .single();

  if (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: corsHeaders },
    );
  }

  if (!data) {
    return new Response(
      JSON.stringify({ error: "Blog not found or access denied" }),
      { status: 404, headers: corsHeaders },
    );
  }

  // Step 9: Return success
  return new Response(
    JSON.stringify({ ok: true, id: data.id }),
    { status: 200, headers: corsHeaders },
  );
});
