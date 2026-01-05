import React from 'react';
import { Building2, Globe } from 'lucide-react';

/**
 * TenantBadge - Displays current tenant context.
 * Shows tenant name/logo for context awareness.
 * For platform admins viewing all tenants, shows "All Tenants" indicator.
 * 
 * @param {object} tenant - Current tenant object {id, name, logo_url}
 * @param {boolean} isAllTenants - Platform admin viewing all tenants
 */
const TenantBadge = ({ tenant, isAllTenants = false }) => {
    if (isAllTenants || !tenant) {
        return (
            <div
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg"
                role="status"
                aria-label="Viewing all tenants"
            >
                <Globe className="w-4 h-4 text-amber-600" aria-hidden="true" />
                <span className="text-sm font-medium text-amber-700">
                    All Tenants (Platform View)
                </span>
            </div>
        );
    }

    return (
        <div
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg"
            role="status"
            aria-label={`Current tenant: ${tenant.name}`}
        >
            {tenant.logo_url ? (
                <img
                    src={tenant.logo_url}
                    alt=""
                    className="w-5 h-5 rounded object-cover"
                    aria-hidden="true"
                />
            ) : (
                <Building2 className="w-4 h-4 text-blue-600" aria-hidden="true" />
            )}
            <span className="text-sm font-medium text-blue-700">
                {tenant.name}
            </span>
        </div>
    );
};

export default TenantBadge;
