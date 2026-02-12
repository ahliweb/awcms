import re

schema_path = '/home/data/dev_react/awcms-dev/awcms/supabase/migrations/20260212043432_remote_schema.sql'

def analyze_schema(path):
    with open(path, 'r') as f:
        content = f.read()

    # Find Tables with tenant_id
    # CREATE TABLE "public"."categories" ( ... "tenant_id" ... )
    # This is hard with regex because table definition spans many lines.
    # But we can look for "CREATE TABLE" and then see if "tenant_id" appears before the next "CREATE" or "ALTER".
    
    # Actually, we can just look at FKs. If there is a FK on 'tenant_id', then the table has 'tenant_id'.
    # And most tables with tenant_id have a FK to tenants (though not always).
    # But for "Missing Indexes", we already know the column name.
    
    # 1. Identify Missing Indexes
    # Reuse previous logic
    fk_pattern = re.compile(
        r'ALTER TABLE(?: ONLY)? "public"\."(?P<table>\w+)"\s+'
        r'ADD CONSTRAINT "(?P<name>\w+)" FOREIGN KEY \("?(?P<column>\w+)"?\) REFERENCES "public"\."(?P<ref_table>\w+)"',
        re.DOTALL | re.MULTILINE
    )
    fks = []
    for match in fk_pattern.finditer(content):
        fks.append(match.groupdict())

    index_pattern = re.compile(
        r'CREATE(?: UNIQUE)? INDEX "?(?P<name>\w+)"? ON "public"\."(?P<table>\w+)"(?: USING "?\w+"?)?\s*\("?(?P<column>\w+)"?\)',
        re.DOTALL | re.MULTILINE | re.IGNORECASE
    )
    indexes = []
    for match in index_pattern.finditer(content):
        indexes.append(match.groupdict())

    missing_indexes = []
    for fk in fks:
        table = fk['table']
        column = fk['column']
        has_index = False
        for idx in indexes:
            if idx['table'] == table and idx['column'] == column:
                has_index = True
                break
        if not has_index:
            missing_indexes.append(fk)

    # 2. Identify Permissive Policies and Check for tenant_id
    policy_pattern = re.compile(
        r'CREATE POLICY "(?P<name>[^"]+)" ON "public"\."(?P<table>\w+)"\s+(?P<definition>.*?\s+USING \(true\))',
        re.DOTALL | re.MULTILINE | re.IGNORECASE
    )
    
    # Check for WITH CHECK (true) too
    policy_pattern_insert = re.compile(
        r'CREATE POLICY "(?P<name>[^"]+)" ON "public"\."(?P<table>\w+)"\s+(?P<definition>.*?\s+WITH CHECK \(true\))',
        re.DOTALL | re.MULTILINE | re.IGNORECASE
    )


    permissive_policies = []
    for match in policy_pattern.finditer(content):
        permissive_policies.append(match.groupdict())
    
    for match in policy_pattern_insert.finditer(content):
        permissive_policies.append(match.groupdict())

    # Check for tenant_id in permissive tables
    # We'll just regex the file for `CREATE TABLE "public"."{table}" ... "tenant_id"`
    # A bit heuristical but should work.
    
    security_fixes = []
    
    for p in permissive_policies:
        table = p['table']
        # Check if table has tenant_id
        # Regex: CREATE TABLE "public"."table" ... tenant_id ... ;
        # We search from "CREATE TABLE ... table" until ";"
        table_def_pattern = re.compile(r'CREATE TABLE "public"\."'+table+r'"\s*\(([^;]+)\);', re.DOTALL)
        match = table_def_pattern.search(content)
        has_tenant_id = False
        if match:
            table_body = match.group(1)
            if '"tenant_id"' in table_body or ' tenant_id ' in table_body:
                has_tenant_id = True
        
        # Also check if it was in the FK list with tenant_id
        if not has_tenant_id:
            for fk in fks:
                if fk['table'] == table and fk['column'] == 'tenant_id':
                    has_tenant_id = True
                    break
        
        if has_tenant_id:
             security_fixes.append(p)
    
    # Generate Report
    print("# Implementation Plan - Supabase Advisor Fixes")
    
    print("\n## 1. Security Fixes (Permissive Policies)")
    print("The following tables have `tenant_id` but use permissive `USING (true)` or `WITH CHECK (true)` policies. These will be updated to enforce strict tenancy.")
    
    for item in security_fixes:
        print(f"- **Table**: `{item['table']}`")
        print(f"  - **Policy**: `{item['name']}`")
        print(f"  - **Current**: `{item['definition'].strip()}`")
        print(f"  - **Fix**: Update to `USING (tenant_id = (select auth.uid() from auth.users where id = auth.uid()) -> No, use public.current_tenant_id() or standard AWCMS pattern)`")

    print("\n## 2. Performance Fixes (Missing Indexes)")
    print("The following Foreign Keys are unindexed. We will create indexes for them.")
    
    # Prioritize tenant_id indexes
    tenant_id_indexes = [x for x in missing_indexes if x['column'] == 'tenant_id']
    other_indexes = [x for x in missing_indexes if x['column'] != 'tenant_id']
    
    print(f"\n### 2.1 Critical Indexes (tenant_id) - {len(tenant_id_indexes)} found")
    for item in tenant_id_indexes:
        print(f"- Table: `{item['table']}`, Column: `{item['column']}`")
        
    print(f"\n### 2.2 Other Foreign Key Indexes - {len(other_indexes)} found")
    for item in other_indexes[:50]:
        print(f"- Table: `{item['table']}`, Column: `{item['column']}`")
    if len(other_indexes) > 50:
        print(f"- ... and {len(other_indexes) - 50} more")

if __name__ == "__main__":
    analyze_schema(schema_path)
