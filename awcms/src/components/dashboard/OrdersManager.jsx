
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import StatusBadge from '@/components/ui/StatusBadge';
import { User, ShoppingCart } from 'lucide-react';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

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
        </AdminPageLayout>
    );
}

export default OrdersManager;
