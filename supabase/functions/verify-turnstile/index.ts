import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-application-name, x-tenant-id",
};

serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { token } = await req.json();

        if (!token) {
            return new Response(
                JSON.stringify({ success: false, error: "Missing turnstile token" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const secretKey = Deno.env.get("TURNSTILE_SECRET_KEY");

        if (!secretKey) {
            console.error("TURNSTILE_SECRET_KEY not configured");
            return new Response(
                JSON.stringify({ success: false, error: "Server configuration error" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Verify with Cloudflare
        const formData = new FormData();
        formData.append("secret", secretKey);
        formData.append("response", token);

        const ip = req.headers.get("cf-connecting-ip");
        if (ip) formData.append("remoteip", ip);

        const verifyResponse = await fetch(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            {
                method: "POST",
                body: formData,
            }
        );

        const verifyResult = await verifyResponse.json();

        console.log("[Turnstile] Verification result:", {
            success: verifyResult.success,
            errorCodes: verifyResult["error-codes"],
            ip: ip
        });

        if (verifyResult.success) {
            return new Response(
                JSON.stringify({ success: true, ip: ip }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        } else {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Verification failed",
                    codes: verifyResult["error-codes"],
                }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }
    } catch (error) {
        console.error("[Turnstile] Error:", error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return new Response(
            JSON.stringify({ success: false, error: errorMessage }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
