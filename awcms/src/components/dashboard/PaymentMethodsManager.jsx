/**
 * Payment Methods Manager - Configure available payment options
 */
import React from 'react';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { CreditCard } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

function PaymentMethodsManager() {
    const columns = [
        {
            key: 'icon',
            label: '',
            className: 'w-12',
            render: (val) => {
                if (val && val.startsWith('http')) {
                    return <img src={val} alt="" className="w-8 h-8 object-contain" />;
                }
                return (
                    <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                        <CreditCard className="w-4 h-4 text-primary" />
                    </div>
                );
            }
        },
        { key: 'name', label: 'Payment Method', className: 'font-medium' },
        {
            key: 'type',
            label: 'Type',
            render: (val) => {
                const typeConfig = {
                    xendit: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400', label: 'Xendit' },
                    bank_transfer: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', label: 'Bank Transfer' },
                    cod: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400', label: 'Cash on Delivery' },
                    manual: { bg: 'bg-muted', text: 'text-muted-foreground', label: 'Manual' }
                };
                const config = typeConfig[val] || typeConfig.manual;
                return (
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
                        {config.label}
                    </span>
                );
            }
        },
        {
            key: 'description',
            label: 'Description',
            render: (val) => val ? (
                <span className="text-slate-600 line-clamp-1 max-w-[300px]">{val}</span>
            ) : (
                <span className="text-slate-300">-</span>
            )
        },
        {
            key: 'is_active',
            label: 'Status',
            render: (val) => val ? (
                <span className="text-green-600 dark:text-green-400 text-xs font-medium">✓ Active</span>
            ) : (
                <span className="text-muted-foreground/50 text-xs">Inactive</span>
            )
        },
        { key: 'sort_order', label: 'Order', className: 'text-center' }
    ];

    const formFields = [
        { key: 'name', label: 'Method Name', required: true, description: 'E.g., Credit Card, Bank Transfer' },
        {
            key: 'type', label: 'Payment Type', type: 'select', required: true, options: [
                { value: 'xendit', label: 'Xendit (Online Payment)' },
                { value: 'bank_transfer', label: 'Bank Transfer (Manual)' },
                { value: 'cod', label: 'Cash on Delivery' },
                { value: 'manual', label: 'Manual Payment' }
            ]
        },
        { key: 'description', label: 'Description', type: 'textarea', description: 'Shown to customers during checkout' },
        { key: 'icon', label: 'Icon URL', description: 'Image URL for payment method icon' },
        {
            key: 'config',
            label: 'Configuration (JSON)',
            type: 'textarea',
            description: 'JSON config for payment gateway. Leave empty for manual methods.',
            placeholder: '{"api_key": "your_xendit_key"}'
        },
        { key: 'is_active', label: 'Active', type: 'boolean', description: 'Enable this payment method' },
        { key: 'sort_order', label: 'Display Order', type: 'number', description: 'Lower numbers appear first' }
    ];

    return (
        <AdminPageLayout requiredPermission="tenant.payment_methods.read">
            <PageHeader
                title="Payment Methods"
                description="Configure available payment options for checkout."
                icon={CreditCard}
                breadcrumbs={[{ label: 'Payment Methods', icon: CreditCard }]}
            />

            <div className="space-y-6">
                <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                        <div className="p-2 bg-primary/10 rounded-lg">
                            <CreditCard className="w-5 h-5 text-primary" />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-semibold text-foreground mb-1">Xendit Configuration</h3>
                            <p className="text-sm text-muted-foreground mb-2">
                                To enable online payments via Xendit, you need to configure the API key in the Edge Function.
                            </p>
                            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                                <li>Get your API key from <a href="https://dashboard.xendit.co" target="_blank" rel="noopener noreferrer" className="underline font-medium text-primary hover:text-primary/80">Xendit Dashboard</a></li>
                                <li>Add <code className="bg-muted px-1 rounded text-xs font-mono text-foreground">XENDIT_API_KEY</code> to Supabase Edge Function secrets</li>
                                <li>Create a payment method with type "Xendit"</li>
                            </ol>
                        </div>
                    </div>
                </div>

                <GenericContentManager
                    tableName="payment_methods"
                    resourceName="Payment Method"
                    columns={columns}
                    formFields={formFields}
                    permissionPrefix="payment_methods"
                    showBreadcrumbs={false}
                />
            </div>
        </AdminPageLayout>
    );
}

export default PaymentMethodsManager;
