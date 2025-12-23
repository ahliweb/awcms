
import React from 'react';
import { Link } from 'react-router-dom';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { Package, Truck, CreditCard, User, ShoppingCart, ChevronRight, Home } from 'lucide-react';

function OrdersManager() {
    const columns = [
        {
            key: 'id',
            label: 'Order #',
            className: 'font-mono text-xs',
            render: (val) => (
                <span className="bg-slate-100 px-2 py-1 rounded">
                    #{val?.substring(0, 8)}
                </span>
            )
        },
        {
            key: 'user',
            label: 'Customer',
            render: (val, row) => (
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                        <User className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex flex-col">
                        <span className="font-medium text-sm">{val?.full_name || val?.email || 'Guest'}</span>
                        <span className="text-xs text-slate-400">{val?.email}</span>
                    </div>
                </div>
            )
        },
        {
            key: 'total_amount',
            label: 'Total',
            render: (val) => (
                <span className="font-semibold text-green-600">
                    {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)}
                </span>
            )
        },
        {
            key: 'status',
            label: 'Order Status',
            render: (value) => {
                const statusConfig = {
                    pending: { bg: 'bg-amber-100', text: 'text-amber-700', icon: '⏳' },
                    paid: { bg: 'bg-blue-100', text: 'text-blue-700', icon: '💳' },
                    processing: { bg: 'bg-purple-100', text: 'text-purple-700', icon: '📦' },
                    shipped: { bg: 'bg-cyan-100', text: 'text-cyan-700', icon: '🚚' },
                    completed: { bg: 'bg-green-100', text: 'text-green-700', icon: '✅' },
                    cancelled: { bg: 'bg-red-100', text: 'text-red-700', icon: '❌' },
                    refunded: { bg: 'bg-slate-100', text: 'text-slate-700', icon: '↩️' }
                };
                const config = statusConfig[value] || statusConfig.pending;
                return (
                    <span className={`px-2 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1 ${config.bg} ${config.text}`}>
                        <span>{config.icon}</span>
                        {value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Pending'}
                    </span>
                );
            }
        },
        {
            key: 'payment_status',
            label: 'Payment',
            render: (val) => {
                const config = {
                    paid: { bg: 'bg-green-100', text: 'text-green-700' },
                    unpaid: { bg: 'bg-red-100', text: 'text-red-700' },
                    partial: { bg: 'bg-amber-100', text: 'text-amber-700' },
                    refunded: { bg: 'bg-slate-100', text: 'text-slate-600' }
                };
                const style = config[val] || config.unpaid;
                return (
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${style.bg} ${style.text}`}>
                        {val || 'Unpaid'}
                    </span>
                );
            }
        },
        {
            key: 'tracking_number',
            label: 'Tracking',
            render: (val) => val ? (
                <span className="font-mono text-xs bg-slate-100 px-2 py-1 rounded">{val}</span>
            ) : (
                <span className="text-slate-300 text-xs">-</span>
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
        { key: 'user_id', label: 'Customer', type: 'relation', table: 'users', relationLabel: 'email', description: 'Customer who placed the order', readOnly: true },
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
        { key: 'subtotal', label: 'Subtotal', type: 'number', readOnly: true },
        { key: 'shipping_cost', label: 'Shipping Cost', type: 'number' },
        { key: 'total_amount', label: 'Total Amount', type: 'number', readOnly: true },
        { key: 'shipping_address', label: 'Shipping Address', type: 'textarea' },
        { key: 'tracking_number', label: 'Tracking Number', description: 'Courier tracking number' },
        { key: 'notes', label: 'Order Notes', type: 'textarea', description: 'Internal notes about this order' }
    ];

    return (
        <div className="space-y-6">
            {/* Breadcrumb Navigation */}
            <nav className="flex items-center text-sm text-slate-500">
                <Link to="/cmspanel" className="hover:text-blue-600 transition-colors flex items-center gap-1">
                    <Home className="w-4 h-4" />
                    Dashboard
                </Link>
                <ChevronRight className="w-4 h-4 mx-2 text-slate-300" />
                <span className="flex items-center gap-1 text-slate-700 font-medium">
                    <ShoppingCart className="w-4 h-4" />
                    Orders
                </span>
            </nav>

            <GenericContentManager
                tableName="orders"
                resourceName="Order"
                columns={columns}
                formFields={formFields}
                permissionPrefix="orders"
                canCreate={false}
                customSelect="*, user:users(id, email, full_name)"
                showBreadcrumbs={false}
            />
        </div>
    );
}

export default OrdersManager;
