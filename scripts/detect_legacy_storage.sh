#!/bin/bash

# AWCMS - Detect Legacy Supabase Storage & Functions Usage
# This script scans the codebase to ensure no direct Supabase storage
# or edge functions are being used directly from the frontend, ensuring
# all traffic routes through the Cloudflare Edge Worker API.

echo "Scanning for legacy supabase.storage usage..."
STORAGE_HITS=$(grep -rn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist "supabase.storage" awcms/src/)

if [ -n "$STORAGE_HITS" ]; then
  echo "❌ Found legacy supabase.storage usage. All media access should use VITE_EDGE_URL."
  echo "$STORAGE_HITS"
  exit 1
else
  echo "✅ No legacy supabase.storage usage found."
fi

echo ""
echo "Scanning for legacy supabase.functions.invoke usage..."
FUNC_HITS=$(grep -rn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist "supabase.functions.invoke" awcms/src/)

if [ -n "$FUNC_HITS" ]; then
  echo "❌ Found legacy supabase.functions.invoke usage. Migration to Edge Worker API is required."
  echo "$FUNC_HITS"
  exit 1
else
  echo "✅ No legacy supabase.functions.invoke usage found."
fi

echo ""
echo "Scanning for direct Supabase edge function calls..."
DIRECT_FUNC_HITS=$(grep -rn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist "/functions/v1" awcms/src/)

if [ -n "$DIRECT_FUNC_HITS" ]; then
  echo "❌ Found direct calls to /functions/v1. These should route to VITE_EDGE_URL/api/..."
  echo "$DIRECT_FUNC_HITS"
  exit 1
else
  echo "✅ No direct calls to Supabase edge functions found."
fi

echo ""
echo "🎉 Codebase is clean of legacy Supabase storage and edge function calls!"
exit 0
