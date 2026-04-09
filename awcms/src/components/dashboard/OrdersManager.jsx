
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { User, ShoppingCart, ReceiptText, Wallet, PackageCheck } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/emdash-admin';

function OrdersManager() {
    const columns = [
        {
            key: 'id',
            label: 'Order #',
            className: 'font-mono text-xs',
            render: (val) => (
                <span className="bg-muted px-2 py-1 rounded text-muted-foreground">
                    #{val?.substring(0, 8)}
                </span>
            )
        },
        {
            key: 'user',
            label: 'Customer',
            render: (val, _row) => (
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                        <User className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex flex-col">
                        <span className="font-medium text-sm text-foreground">{val?.full_name || val?.email || 'Guest'}</span>
                        <span className="text-xs text-muted-foreground">{val?.email}</span>
                    </div>
                </div>
            )
        },
        {
            key: 'total_amount',
            label: 'Total',
            render: (val) => (
                <span className="font-semibold text-foreground">
                    {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)}
                </span>
            )
        },
        {
            key: 'status',
            label: 'Order Status',
            render: (value) => <StatusBadge status={value || 'pending'} />
        },
        {
            key: 'payment_status',
            label: 'Payment',
            render: (val) => <StatusBadge status={val || 'unpaid'} />
        },
        {
            key: 'tracking_number',
            label: 'Tracking',
            render: (val) => val ? (
                <span className="font-mono text-xs bg-muted px-2 py-1 rounded text-muted-foreground">{val}</span>
            ) : (
                <span className="text-muted-foreground/50 text-xs">-</span>
            )
        },
        {
            key: 'created_at',
            label: 'Date',
            type: 'date',
            render: (value) => value ? new Date(value).toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            }) : '-'
        }
    ];

    const formFields = [
        { key: 'user_id', label: 'Customer', type: 'relation', table: 'users', relationLabel: 'email', description: 'Customer who placed the order', required: true },
        {
            key: 'status', label: 'Order Status', type: 'select', options: [
                { value: 'pending', label: '⏳ Pending' },
                { value: 'paid', label: '💳 Paid' },
                { value: 'processing', label: '📦 Processing' },
                { value: 'shipped', label: '🚚 Shipped' },
                { value: 'completed', label: '✅ Completed' },
                { value: 'cancelled', label: '❌ Cancelled' },
                { value: 'refunded', label: '↩️ Refunded' }
            ]
        },
        {
            key: 'payment_status', label: 'Payment Status', type: 'select', options: [
                { value: 'unpaid', label: 'Unpaid' },
                { value: 'paid', label: 'Paid' },
                { value: 'partial', label: 'Partial Payment' },
                { value: 'refunded', label: 'Refunded' }
            ]
        },
        { key: 'payment_method', label: 'Payment Method', description: 'Bank Transfer, Credit Card, etc.' },
        { key: 'subtotal', label: 'Subtotal', type: 'number', readOnly: false },
        { key: 'shipping_cost', label: 'Shipping Cost', type: 'number' },
        {
            key: 'total_amount',
            label: 'Total Amount',
            type: 'number',
            readOnly: true,
            calculate: (data) => {
                const sub = Number(data.subtotal) || 0;
                const ship = Number(data.shipping_cost) || 0;
                return sub + ship;
            }
        },
        { key: 'shipping_address', label: 'Shipping Address', type: 'textarea' },
        { key: 'tracking_number', label: 'Tracking Number', description: 'Courier tracking number' },
        { key: 'notes', label: 'Order Notes', type: 'textarea', description: 'Internal notes about this order' }
    ];

    return (
        <AdminPageLayout requiredPermission="tenant.orders.read">
            <PageHeader
                title="Orders"
                description="Manage customer orders and transactions."
                icon={ShoppingCart}
                breadcrumbs={[{ label: 'Orders', icon: ShoppingCart }]}
            />

            <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Order Desk</p>
                            <p className="mt-1 text-sm font-semibold text-foreground">Transaction oversight</p>
                            <p className="text-xs text-muted-foreground">Review payment, shipping, and lifecycle state in one queue</p>
                        </div>
                        <span className="rounded-xl border border-primary/25 bg-primary/10 p-2 text-primary">
                            <ShoppingCart className="h-4 w-4" />
                        </span>
                    </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Billing</p>
                            <p className="mt-1 text-sm font-semibold text-foreground">Payment status tracking</p>
                            <p className="text-xs text-muted-foreground">Keep unpaid, partial, and refunded states visible</p>
                        </div>
                        <span className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-300">
                            <Wallet className="h-4 w-4" />
                        </span>
                    </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Fulfillment</p>
                            <p className="mt-1 text-sm font-semibold text-foreground">Shipping readiness</p>
                            <p className="text-xs text-muted-foreground">Track processing, shipped, and completed milestones</p>
                        </div>
                        <span className="rounded-xl border border-sky-500/25 bg-sky-500/10 p-2 text-sky-700 dark:text-sky-300">
                            <PackageCheck className="h-4 w-4" />
                        </span>
                    </div>
                </div>

                <div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Audit Trail</p>
                            <p className="mt-1 text-sm font-semibold text-foreground">Refresh-safe order IDs</p>
                            <p className="text-xs text-muted-foreground">Operators can cross-check short IDs and shipping references quickly</p>
                        </div>
                        <span className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
                            <ReceiptText className="h-4 w-4" />
                        </span>
                    </div>
                </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm backdrop-blur-sm">
                <div className="border-b border-border/70 bg-gradient-to-r from-primary/12 via-background/40 to-emerald-500/12 p-4 sm:p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                                <ReceiptText className="h-3.5 w-3.5 text-primary" />
                                Commerce Operations
                            </div>
                            <h3 className="text-base font-semibold text-foreground">Order pipeline and support handoff</h3>
                            <p className="max-w-2xl text-sm text-muted-foreground">Resolve payment issues, update fulfillment details, and keep order status transitions visible for support and operations teams.</p>
                        </div>
                    </div>
                </div>

                <div className="p-4 sm:p-5">
                    <GenericContentManager
                        tableName="orders"
                        resourceName="Order"
                        columns={columns}
                        formFields={formFields}
                        permissionPrefix="orders"
                        canCreate={false}
                        customSelect="*, user:users(id, full_name, email)"
                        showBreadcrumbs={false}
                        showHeader={false}
                        omitCreatedBy={true}
                    />
                </div>
            </div>
        </AdminPageLayout>
    );
}

export default OrdersManager;
