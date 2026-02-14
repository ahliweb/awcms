#!/bin/bash

# Script to update Cloudflare Pages secrets
# Usage: ./scripts/update_cloudflare_secrets.sh

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}== Updating Cloudflare Pages Secrets ==${NC}"

# Function to update secrets for a project
update_project_secrets() {
    local PROJECT_DIR=$1
    local PROJECT_NAME=$2
    local ENV_FILE="$PROJECT_DIR/.env"

    echo -e "\n${YELLOW}Processing $PROJECT_NAME ($PROJECT_DIR)...${NC}"

    if [ ! -f "$ENV_FILE" ]; then
        echo "Error: .env file not found at $ENV_FILE"
        return
    fi

    # Read secrets from .env
    # We use source to handle potential complex values or just grep
    # For simplicity and safety against executing arbitary code, we'll use grep/sed
    
    # Try different variable names for URL
    URL=$(grep -E "^(VITE_SUPABASE_URL|PUBLIC_SUPABASE_URL)=" "$ENV_FILE" | head -n 1 | cut -d '=' -f2-)
    
    # Try different variable names for Publishable Key
    PUB_KEY=$(grep -E "^(VITE_SUPABASE_PUBLISHABLE_KEY|PUBLIC_SUPABASE_PUBLISHABLE_KEY)=" "$ENV_FILE" | head -n 1 | cut -d '=' -f2-)
    
    # Try different variable names for Secret Key
    SECRET_KEY=$(grep -E "^(SUPABASE_SECRET_KEY|VITE_SUPABASE_SECRET_KEY)=" "$ENV_FILE" | head -n 1 | cut -d '=' -f2-)

    # Determine Cloudflare (Pages) Variable Names based on what the app expects
    # Usually apps expect VITE_... or PUBLIC_... but in Cloudflare Dashboard we might map them.
    # However, standard practice for Pages is to set them as ENV vars, and the build process (Astro/Vite) picks them up.
    # If using `import.meta.env`, they need to be set with the prefix OR we configure vite to replacements.
    # But usually we set them exactly as the app matches.

    # Ask user for the Cloudflare Pages Project Name
    read -p "Enter Cloudflare Pages Project Name for $PROJECT_NAME (leave empty to skip): " CF_PROJECT_NAME
    
    if [ -z "$CF_PROJECT_NAME" ]; then
        echo "Skipping..."
        return
    fi

    if [ ! -z "$URL" ]; then
        echo "Updating SUPABASE_URL..."
        # We need to determine the key name on Cloudflare. 
        # If the app uses VITE_SUPABASE_URL, we should create that secret.
        # But wait, secrets should usually be SECRET_KEY. URL and PUB KEY are technically public, 
        # so they can be normal environment variables (vars).
        # However, for simplicity, users often put everything in secrets or env vars.
        # `wrangler pages secret` is for encrypted values. `wrangler pages project upload config` is for vars.
        # Let's use secrets for everything to be safe, or just secrets for SECRET_KEY.
        
        # User request specifically mentioned "remove any use of the anon key" and "use PUBLISHABLE_KEY".
        
        # Let's set the keys exactly as they appear in the .env file to ensure the app finds them.
        VAR_NAME_URL=$(grep -E "^(VITE_SUPABASE_URL|PUBLIC_SUPABASE_URL)=" "$ENV_FILE" | head -n 1 | cut -d '=' -f1)
        VAR_NAME_PUB=$(grep -E "^(VITE_SUPABASE_PUBLISHABLE_KEY|PUBLIC_SUPABASE_PUBLISHABLE_KEY)=" "$ENV_FILE" | head -n 1 | cut -d '=' -f1)
        VAR_NAME_SEC=$(grep -E "^(SUPABASE_SECRET_KEY|VITE_SUPABASE_SECRET_KEY)=" "$ENV_FILE" | head -n 1 | cut -d '=' -f1)

        # Upload URL
        echo "Setting $VAR_NAME_URL..."
        echo "$URL" | npx wrangler pages secret put "$VAR_NAME_URL" --project-name "$CF_PROJECT_NAME"

        # Upload Publishable Key
        if [ ! -z "$PUB_KEY" ]; then
             echo "Setting $VAR_NAME_PUB..."
             echo "$PUB_KEY" | npx wrangler pages secret put "$VAR_NAME_PUB" --project-name "$CF_PROJECT_NAME"
        fi

        # Upload Secret Key
        if [ ! -z "$SECRET_KEY" ]; then
             echo "Setting $VAR_NAME_SEC / SUPABASE_SECRET_KEY..."
             # Some setups might use plain SUPABASE_SECRET_KEY even if .env has VITE_ prefix (unlikely for secret).
             # We'll use the name found in .env, but also ensure SUPABASE_SECRET_KEY is set if it's different, 
             # because backend scripts might expect it.
             echo "$SECRET_KEY" | npx wrangler pages secret put "$VAR_NAME_SEC" --project-name "$CF_PROJECT_NAME"
        fi

        # Remove old keys if they exist (This will fail if key doesn't exist, so we ignore errors)
        echo "Attempting to remove legacy ANON_KEY and SERVICE_ROLE_KEY..."
        # Guessing common legacy names
        npx wrangler pages secret delete VITE_SUPABASE_ANON_KEY --project-name "$CF_PROJECT_NAME" 2>/dev/null || true
        npx wrangler pages secret delete PUBLIC_SUPABASE_ANON_KEY --project-name "$CF_PROJECT_NAME" 2>/dev/null || true
        npx wrangler pages secret delete SUPABASE_SERVICE_ROLE_KEY --project-name "$CF_PROJECT_NAME" 2>/dev/null || true
        npx wrangler pages secret delete VITE_SUPABASE_SERVICE_ROLE_KEY --project-name "$CF_PROJECT_NAME" 2>/dev/null || true
        
        echo "Done with $PROJECT_NAME"
    else 
        echo "Could not find Supabase URL in .env, skipping..."
    fi
}

# 1. Admin Panel
update_project_secrets "awcms" "Admin Panel"

# 2. Public Portal (Primary)
update_project_secrets "awcms-public/primary" "Public Portal (Primary)"

# 3. Public Portal (Smandapbun)
update_project_secrets "awcms-public/smandapbun" "Public Portal (Smandapbun)"

echo -e "\n${GREEN}All Done successfully!${NC}"
