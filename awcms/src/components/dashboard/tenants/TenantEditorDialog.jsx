import { Building, DollarSign, FileText, Globe, Mail, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';

function TenantEditorDialog({
	open,
	onOpenChange,
	editingTenant,
	formData,
	setFormData,
	tenants,
	channelDomains,
	setChannelDomains,
	resourceRules,
	setResourceRules,
	hasRegistry,
	rulesLoading,
	roleLinks,
	setRoleLinks,
	roleLinksLoading,
	loading,
	onSave,
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden border-border/60 flex flex-col">
				<DialogHeader>
					<DialogTitle>{editingTenant ? 'Edit Tenant' : 'New Tenant'}</DialogTitle>
					<DialogDescription>Configure tenant details and subscription.</DialogDescription>
				</DialogHeader>
				<div className="flex-1 overflow-y-auto pr-2">
					<div className="space-y-4 py-4">
						<div className="grid gap-2">
							<Label>Name</Label>
							<Input
								value={formData.name}
								onChange={(event) => setFormData({ ...formData, name: event.target.value })}
								placeholder="Acme Corp"
							/>
						</div>
						<div className="grid gap-2">
							<Label>Slug (Unique ID)</Label>
							<Input
								value={formData.slug}
								onChange={(event) => setFormData({ ...formData, slug: event.target.value.toLowerCase().replace(/\s+/g, '-') })}
								placeholder="acme-corp"
								disabled={Boolean(editingTenant)}
							/>
						</div>
						<div className="grid gap-2">
							<Label>Custom Domain (Optional)</Label>
							<Input
								value={formData.domain}
								onChange={(event) => setFormData({ ...formData, domain: event.target.value })}
								placeholder="app.acme.com"
							/>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label>Parent Tenant</Label>
								<Select
									value={formData.parent_tenant_id || 'none'}
									onValueChange={(value) => setFormData({ ...formData, parent_tenant_id: value === 'none' ? '' : value })}
								>
									<SelectTrigger className="border-input"><SelectValue /></SelectTrigger>
									<SelectContent>
										<SelectItem value="none">None (Top-Level)</SelectItem>
										{tenants
											.filter((tenant) => !editingTenant || tenant.id !== editingTenant.id)
											.map((tenant) => (
												<SelectItem key={tenant.id} value={tenant.id}>{tenant.name}</SelectItem>
											))}
									</SelectContent>
								</Select>
							</div>
							<div className="grid gap-2">
								<Label>Role Inheritance</Label>
								<Select
									value={formData.role_inheritance_mode}
									onValueChange={(value) => setFormData({ ...formData, role_inheritance_mode: value })}
								>
									<SelectTrigger className="border-input"><SelectValue /></SelectTrigger>
									<SelectContent>
										<SelectItem value="auto">Auto Inherit</SelectItem>
										<SelectItem value="linked">Linked Only</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>

						{formData.role_inheritance_mode === 'linked' && formData.parent_tenant_id && (
							<div className="pt-4 border-t border-border">
								<h4 className="mb-3 text-sm font-semibold text-foreground">Linked Roles</h4>
								{roleLinksLoading ? (
									<div className="text-xs text-muted-foreground">Loading role links...</div>
								) : (
									<div className="space-y-2">
										{roleLinks.map((link) => (
											<div key={link.parent_role_id} className="flex items-center gap-2">
												<Checkbox
													checked={link.linked}
													disabled={!link.child_role_id}
													onCheckedChange={(value) => setRoleLinks((previous) => previous.map((item) => item.parent_role_id === link.parent_role_id ? { ...item, linked: Boolean(value) } : item))}
												/>
												<span className="text-sm text-foreground">{link.name}</span>
												{!link.child_role_id && <span className="text-xs text-muted-foreground">Missing child role</span>}
											</div>
										))}
									</div>
								)}
							</div>
						)}

						<div className="grid grid-cols-2 gap-4">
							<div className="grid gap-2">
								<Label>Status</Label>
								<Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
									<SelectTrigger className="border-input"><SelectValue /></SelectTrigger>
									<SelectContent>
										<SelectItem value="active">Active</SelectItem>
										<SelectItem value="suspended">Suspended</SelectItem>
										<SelectItem value="archived">Archived</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="grid gap-2">
								<Label>Subscription</Label>
								<Select value={formData.subscription_tier} onValueChange={(value) => setFormData({ ...formData, subscription_tier: value })}>
									<SelectTrigger className="border-input"><SelectValue /></SelectTrigger>
									<SelectContent>
										<SelectItem value="free">Free</SelectItem>
										<SelectItem value="pro">Pro</SelectItem>
										<SelectItem value="enterprise">Enterprise</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>

						<div className="pt-4 border-t border-border">
							<h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
								<DollarSign className="w-4 h-4 text-muted-foreground" /> Billing Information
							</h4>
							<div className="grid grid-cols-4 gap-4">
								<div className="grid gap-2">
									<Label>Expiry Date</Label>
									<Input
										type="date"
										value={formData.subscription_expires_at}
										onChange={(event) => setFormData({ ...formData, subscription_expires_at: event.target.value })}
									/>
								</div>
								<div className="grid gap-2">
									<Label>Amount</Label>
									<Input
										type="number"
										value={formData.billing_amount}
										onChange={(event) => setFormData({ ...formData, billing_amount: event.target.value })}
										placeholder="99.00"
									/>
								</div>
								<div className="grid gap-2">
									<Label>Currency</Label>
									<Select value={formData.currency} onValueChange={(value) => setFormData({ ...formData, currency: value })}>
										<SelectTrigger className="border-input"><SelectValue /></SelectTrigger>
										<SelectContent>
											<SelectItem value="IDR">IDR (Rupiah)</SelectItem>
											<SelectItem value="USD">USD (Dollar)</SelectItem>
											<SelectItem value="EUR">EUR (Euro)</SelectItem>
											<SelectItem value="SGD">SGD (Singapore)</SelectItem>
											<SelectItem value="MYR">MYR (Ringgit)</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="grid gap-2">
									<Label>Cycle</Label>
									<Select value={formData.billing_cycle} onValueChange={(value) => setFormData({ ...formData, billing_cycle: value })}>
										<SelectTrigger className="border-input"><SelectValue /></SelectTrigger>
										<SelectContent>
											<SelectItem value="monthly">Monthly</SelectItem>
											<SelectItem value="yearly">Yearly</SelectItem>
											<SelectItem value="custom">Custom</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>

							<div className="grid gap-2 mt-4">
								<Label className="flex items-center gap-1"><Globe className="w-3 h-3 text-muted-foreground" /> Default Language</Label>
								<Select value={formData.locale} onValueChange={(value) => setFormData({ ...formData, locale: value })}>
									<SelectTrigger className="max-w-[200px] border-input"><SelectValue /></SelectTrigger>
									<SelectContent>
										<SelectItem value="id">🇮🇩 Bahasa Indonesia</SelectItem>
										<SelectItem value="en">🇺🇸 English</SelectItem>
										<SelectItem value="zh">🇨🇳 中文 (Chinese)</SelectItem>
										<SelectItem value="ja">🇯🇵 日本語 (Japanese)</SelectItem>
										<SelectItem value="ko">🇰🇷 한국어 (Korean)</SelectItem>
										<SelectItem value="ar">🇸🇦 العربية (Arabic)</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>

						<div className="pt-4 border-t border-border">
							<h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
								<Building className="w-4 h-4 text-muted-foreground" /> Resource Sharing
							</h4>
							<p className="mb-3 text-xs text-muted-foreground">
								Configure which resources are shared across tenant levels. Shared resources allow read/write access for tenant admins.
							</p>
							{rulesLoading ? (
								<div className="text-xs text-muted-foreground">Loading resource rules...</div>
							) : !hasRegistry ? (
								<div className="text-xs text-muted-foreground">Resource registry not available.</div>
							) : (
								<div className="space-y-3">
									{resourceRules.map((rule) => (
										<div key={rule.resource_key} className="grid grid-cols-[1fr_160px_160px] gap-3 items-center">
											<div>
												<div className="text-sm font-medium text-foreground">{rule.resource_key}</div>
												{rule.description && <div className="text-xs text-muted-foreground">{rule.description}</div>}
											</div>
											<Select
												value={rule.share_mode}
												onValueChange={(value) => setResourceRules((previous) => previous.map((item) => item.resource_key === rule.resource_key ? { ...item, share_mode: value } : item))}
											>
												<SelectTrigger className="border-input"><SelectValue /></SelectTrigger>
												<SelectContent>
													<SelectItem value="isolated">Isolated</SelectItem>
													<SelectItem value="shared_descendants">Share to Descendants</SelectItem>
													<SelectItem value="shared_ancestors">Share to Ancestors</SelectItem>
													<SelectItem value="shared_all">Share All Levels</SelectItem>
												</SelectContent>
											</Select>
											<Select
												value={rule.access_mode}
												onValueChange={(value) => setResourceRules((previous) => previous.map((item) => item.resource_key === rule.resource_key ? { ...item, access_mode: value } : item))}
											>
												<SelectTrigger className="border-input"><SelectValue /></SelectTrigger>
												<SelectContent>
													<SelectItem value="read">Read Only</SelectItem>
													<SelectItem value="write">Write Only</SelectItem>
													<SelectItem value="read_write">Read & Write</SelectItem>
												</SelectContent>
											</Select>
										</div>
									))}
								</div>
							)}
						</div>

						<div className="pt-4 border-t border-border">
							<h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
								<FileText className="w-4 h-4 text-muted-foreground" /> Administrative Notes
							</h4>
							<div className="grid gap-4">
								<div className="grid gap-2">
									<Label className="flex items-center gap-1"><Mail className="w-3 h-3 text-muted-foreground" /> Contact Email</Label>
									<Input
										type="email"
										value={formData.contact_email}
										onChange={(event) => setFormData({ ...formData, contact_email: event.target.value })}
										placeholder="admin@tenant.com"
									/>
								</div>
								<div className="grid gap-2">
									<Label>Notes</Label>
									<textarea
										value={formData.notes}
										onChange={(event) => setFormData({ ...formData, notes: event.target.value })}
										placeholder="Internal notes about this tenant..."
										className="flex min-h-[80px] w-full rounded-md border border-input px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
									/>
								</div>
							</div>
						</div>

						<div className="pt-4 border-t border-border">
							<h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
								<Radio className="w-4 h-4 text-muted-foreground" /> Channel Domains
							</h4>
							<p className="mb-3 text-xs text-muted-foreground">Configure domain mappings for each channel.</p>
							<div className="space-y-3">
								<div className="grid grid-cols-[120px_1fr] items-center gap-2">
									<Label className="text-xs font-medium">Web Public</Label>
									<Input
										value={channelDomains.web_public}
										onChange={(event) => setChannelDomains({ ...channelDomains, web_public: event.target.value })}
										placeholder="primarypublic.example.com"
										className="text-sm"
									/>
								</div>
								<div className="grid grid-cols-[120px_1fr] items-center gap-2">
									<Label className="text-xs font-medium">Mobile</Label>
									<Input
										value={channelDomains.mobile}
										onChange={(event) => setChannelDomains({ ...channelDomains, mobile: event.target.value })}
										placeholder="primarymobile.example.com"
										className="text-sm"
									/>
								</div>
								<div className="grid grid-cols-[120px_1fr] items-center gap-2">
									<Label className="text-xs font-medium">ESP32</Label>
									<Input
										value={channelDomains.esp32}
										onChange={(event) => setChannelDomains({ ...channelDomains, esp32: event.target.value })}
										placeholder="primaryesp32.example.com"
										className="text-sm"
									/>
								</div>
							</div>
						</div>
					</div>
				</div>
				<DialogFooter className="pt-4 border-t">
					<Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
					<Button onClick={onSave} disabled={loading}>Save Changes</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export default TenantEditorDialog;
