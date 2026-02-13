
import { useState, useEffect } from 'react';
import { Reorder } from 'framer-motion';
import { GripVertical, Plus, Save, Trash2, Lock, Edit, ChevronRight, ChevronDown, RefreshCw, Menu, LayoutTemplate } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { usePermissions } from '@/contexts/PermissionContext';
import { useTenant } from '@/contexts/TenantContext';
import { PUBLIC_MODULES, getModulesByGroup } from '@/lib/publicModuleRegistry';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';

// Available Menu Locations
const MENU_LOCATIONS = [
  { id: 'header', label: 'Primary Header' },
  { id: 'footer', label: 'Footer' },
  { id: 'public_sidebar', label: 'Public Sidebar' },
  { id: 'mobile_menu', label: 'Mobile Menu' }
];

function MenusManager() {
  const { toast } = useToast();
  const { hasPermission, isPlatformAdmin } = usePermissions();
  const { currentTenant } = useTenant();

  // Data State
  const [menus, setMenus] = useState([]); // This will store the TREE structure
  const [flatMenus, setFlatMenus] = useState([]); // Store flat list for parent selection
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentLocation, setCurrentLocation] = useState('header');

  // Editor State
  const [isEditing, setIsEditing] = useState(false);
  const [editingMenu, setEditingMenu] = useState(null);
  const [menuFormData, setMenuFormData] = useState({});

  // Permission Editor State
  const [isPermEditorOpen, setIsPermEditorOpen] = useState(false);
  const [selectedMenuPerms, setSelectedMenuPerms] = useState(null);
  const [menuPermissions, setMenuPermissions] = useState({});
  const [syncing, setSyncing] = useState(false);
  const [selectedModule, setSelectedModule] = useState('');

  const canView = hasPermission('tenant.menu.read');
  const canCreate = hasPermission('tenant.menu.create');
  const canEdit = hasPermission('tenant.menu.update');
  const canDelete = hasPermission('tenant.menu.delete');

  const [pages, setPages] = useState([]);

  useEffect(() => {
    if (canView) {
      fetchMenus();
      fetchRoles();
      fetchPages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, currentLocation, currentTenant?.id]); // Re-fetch when location or tenant changes

  const fetchPages = async () => {
    try {
      let q = supabase.from('pages').select('id, title, slug, status').neq('status', 'archived');
      if (currentTenant?.id) q = q.eq('tenant_id', currentTenant.id);

      const { data, error } = await q;
      if (!error) setPages(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchMenus = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('menus')
        .select('*, tenant:tenants(name)')
        .is('deleted_at', null)
        .eq('location', currentLocation)
        .order('order', { ascending: true });

      if (currentTenant?.id) {
        query = query.eq('tenant_id', currentTenant.id);
      }

      const { data, error } = await query;

      if (error) throw error;

      setFlatMenus(data || []);
      const tree = buildMenuTree(data || []);
      setMenus(tree);
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Error fetching menus', description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const buildMenuTree = (items) => {
    const menuMap = {};
    const roots = [];

    // Initialize map
    items.forEach(item => {
      menuMap[item.id] = { ...item, children: [] };
    });

    // Build hierarchy
    items.forEach(item => {
      if (item.parent_id && menuMap[item.parent_id]) {
        menuMap[item.parent_id].children.push(menuMap[item.id]);
      } else {
        roots.push(menuMap[item.id]);
      }
    });

    // Sort by order
    roots.sort((a, b) => a.order - b.order);
    Object.values(menuMap).forEach(node => {
      node.children.sort((a, b) => a.order - b.order);
    });

    return roots;
  };

  const fetchRoles = async () => {
    if (!currentTenant?.id && !isPlatformAdmin) {
      setRoles([]);
      return;
    }

    let query = supabase
      .from('roles')
      .select('id, name, tenant_id')
      .is('deleted_at', null)
      .order('name');

    if (currentTenant?.id) {
      query = query.eq('tenant_id', currentTenant.id);
    } else {
      query = query.is('tenant_id', null);
    }

    const { data } = await query;
    setRoles(data || []);
  };

  const handleReorder = (newOrder) => {
    setMenus(newOrder);
  };

  const handleChildReorder = (parentId, newChildrenOrder) => {
    const updateRecursive = (items) => {
      return items.map(item => {
        if (item.id === parentId) {
          return { ...item, children: newChildrenOrder };
        }
        if (item.children) {
          return { ...item, children: updateRecursive(item.children) };
        }
        return item;
      });
    };
    setMenus(updateRecursive(menus));
  };

  const saveOrder = async () => {
    try {
      // Flatten the current tree state back into a list of updates
      const updates = [];

      const processNode = (node, index) => {
        updates.push({ id: node.id, order: index });
        if (node.children && node.children.length > 0) {
          node.children.forEach((child, childIndex) => processNode(child, childIndex));
        }
      };

      menus.forEach((menu, index) => processNode(menu, index));

      // Use RPC to avoid 400 errors with partial upserts
      const { error } = await supabase.rpc('update_menu_order', { payload: updates });

      if (error) throw error;

      toast({ title: 'Menu order saved', description: 'The navigation structure has been updated.' });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Failed to save order', description: err.message });
    }
  };

  const handleEdit = (menu) => {
    setEditingMenu(menu);
    if (menu) {
      // Ensure boolean values are properly set when editing existing menu
      setMenuFormData({
        ...menu,
        is_active: menu.is_active === true,
        is_public: menu.is_public === true,
        page_id: menu.page_id || '', // Handle page_id
        location: menu.location || currentLocation
      });
    } else {
      // Default values for new menu
      setMenuFormData({
        label: '',
        url: '',
        name: '',
        is_public: true,
        is_active: true,
        parent_id: null,
        page_id: '',
        location: currentLocation
      });
    }
    setIsEditing(true);
  };

  // Handle Page Selection
  const handlePageSelect = (pageId) => {
    const page = pages.find(p => p.id === pageId);
    if (page) {
      setMenuFormData(prev => ({
        ...prev,
        page_id: pageId,
        url: page.slug.startsWith('/') ? page.slug : `/${page.slug}`, // Auto-set URL
        label: prev.label || page.title // Auto-set label if empty
      }));
    } else {
      // Clear page association
      setMenuFormData(prev => ({ ...prev, page_id: null }));
    }
  };

  const handleSaveMenu = async (e) => {
    e.preventDefault();

    const payload = {
      label: menuFormData.label,
      name: menuFormData.name || menuFormData.label.toLowerCase().replace(/[^a-z0-9_]+/g, '_'),
      url: menuFormData.url,
      parent_id: menuFormData.parent_id || null,
      page_id: menuFormData.page_id || null,
      location: menuFormData.location || currentLocation,
      is_public: menuFormData.is_public,
      is_active: menuFormData.is_active,
      updated_at: new Date().toISOString()
    };

    try {
      let error;
      if (editingMenu) {
        const { error: updateError } = await supabase
          .from('menus')
          .update(payload)
          .eq('id', editingMenu.id);
        error = updateError;
      } else {
        // Get max order for new item
        payload.order = 99; // Default to end, user can reorder
        payload.tenant_id = currentTenant?.id; // Set tenant context
        const { error: insertError } = await supabase
          .from('menus')
          .insert(payload);
        error = insertError;
      }

      if (error) throw error;

      toast({ title: 'Success', description: 'Menu item saved successfully' });
      setIsEditing(false);
      fetchMenus();
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Error saving menu', description: err.message });
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure? This will delete the menu item and hide it from the site.')) return;

    const { error } = await supabase
      .from('menus')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      toast({ variant: 'destructive', title: 'Error deleting menu' });
    } else {
      toast({ title: 'Menu deleted' });
      fetchMenus();
    }
  };

  const openPermissions = async (menu) => {
    setSelectedMenuPerms(menu);
    // Fetch existing perms
    const { data } = await supabase
      .from('menu_permissions')
      .select('role_id, can_view')
      .eq('menu_id', menu.id);

    const permsMap = {};
    roles.forEach(r => permsMap[r.id] = false); // Default false

    if (data) {
      data.forEach(p => {
        if (p.can_view) permsMap[p.role_id] = true;
      });
    }
    setMenuPermissions(permsMap);
    setIsPermEditorOpen(true);
  };

  const savePermissions = async () => {
    const upserts = Object.entries(menuPermissions).map(([roleId, canView]) => ({
      menu_id: selectedMenuPerms.id,
      role_id: roleId,
      can_view: canView,
      updated_at: new Date().toISOString()
    }));

    const { error } = await supabase
      .from('menu_permissions')
      .upsert(upserts, { onConflict: 'menu_id, role_id' });

    if (error) {
      toast({ variant: 'destructive', title: 'Failed to save permissions' });
    } else {
      toast({ title: 'Permissions updated' });
      setIsPermEditorOpen(false);
    }
  };

  // Sync from public module registry
  const syncFromModules = async () => {
    if (!currentTenant?.id) {
      toast({ variant: 'destructive', title: 'No tenant selected' });
      return;
    }
    setSyncing(true);
    try {
      const existingUrls = new Set(flatMenus.map(m => m.url));
      const modulesToAdd = PUBLIC_MODULES.filter(mod => !existingUrls.has(mod.url));

      if (modulesToAdd.length === 0) {
        toast({ title: 'All modules already exist', description: 'No new items to add' });
        setSyncing(false);
        return;
      }

      const maxOrder = Math.max(0, ...flatMenus.map(m => m.order || 0));
      const newItems = modulesToAdd.map((mod, idx) => ({
        label: mod.label,
        name: mod.key,
        url: mod.url,
        icon: mod.icon,
        location: currentLocation,
        parent_id: null,
        order: maxOrder + ((idx + 1) * 10),
        is_active: true,
        is_public: true,
        tenant_id: currentTenant.id,
        created_at: new Date().toISOString(),
      }));

      const { error } = await supabase.from('menus').insert(newItems);
      if (error) throw error;

      toast({ title: 'Sync complete', description: `Added ${newItems.length} menu items` });
      fetchMenus();
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Sync failed', description: err.message });
    } finally {
      setSyncing(false);
    }
  };

  // Handle module picker selection
  const handleModuleSelect = (moduleKey) => {
    setSelectedModule(moduleKey);
    if (moduleKey) {
      const mod = PUBLIC_MODULES.find(m => m.key === moduleKey);
      if (mod) {
        setMenuFormData(prev => ({
          ...prev,
          label: mod.label,
          name: mod.key,
          url: mod.url,
        }));
      }
    }
  };

  if (!canView) return <div className="p-8 text-center text-slate-500">Access Denied</div>;

  return (
    <AdminPageLayout requiredPermission="tenant.menu.read">
      <PageHeader
        title="Menu Management"
        description="Configure public navigation structure for headers, footers, and sidebars"
        icon={Menu}
        breadcrumbs={[{ label: 'Menus', icon: Menu }]}
        actions={(
          <div className="flex gap-3 flex-wrap">
            {canCreate && (
              <Button onClick={syncFromModules} variant="outline" disabled={syncing} className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} /> Sync Modules
              </Button>
            )}
            <Button onClick={saveOrder} variant="outline" className="border-slate-300">
              <Save className="w-4 h-4 mr-2" /> Save Order
            </Button>
            {canCreate && (
              <Button onClick={() => handleEdit(null)} className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" /> Add Item
              </Button>
            )}
          </div>
        )}
      />

      <div className="space-y-6">

        {/* Location Selector */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex items-center gap-2 text-slate-500">
            <LayoutTemplate className="w-5 h-5" />
            <span className="font-medium text-sm">Menu Location:</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {MENU_LOCATIONS.map(loc => (
              <button
                key={loc.id}
                onClick={() => setCurrentLocation(loc.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${currentLocation === loc.id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                  }`}
              >
                {loc.label}
              </button>
            ))}
          </div>
          <div className="flex-1 md:text-right text-xs text-slate-400 hidden md:block">
            Managing: <strong>{MENU_LOCATIONS.find(l => l.id === currentLocation)?.label}</strong>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 min-h-[300px]">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-slate-400">Loading menus...</div>
          ) : menus.length === 0 ? (
            <div className="text-center py-12 text-slate-500">No menu items found for this location. Create one to get started.</div>
          ) : (
            <Reorder.Group axis="y" values={menus} onReorder={handleReorder} className="space-y-3">
              {menus.map((menu) => (
                <MenuReorderItem
                  key={menu.id}
                  menu={menu}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onPerms={openPermissions}
                  onChildReorder={(newChildren) => handleChildReorder(menu.id, newChildren)}
                  isPlatformAdmin={isPlatformAdmin}
                />
              ))}
            </Reorder.Group>
          )}
        </div>

        {/* Edit Menu Dialog */}
        <Dialog open={isEditing} onOpenChange={setIsEditing}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{editingMenu ? 'Edit Menu Item' : 'Create Menu Item'}</DialogTitle>
              <DialogDescription>
                Configure the details for this navigation link in <strong>{MENU_LOCATIONS.find(l => l.id === currentLocation)?.label}</strong>.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSaveMenu} className="space-y-4 py-4">
              {/* Module Picker - only show for new items */}
              {!editingMenu && (
                <div className="space-y-2">
                  <Label>Quick Select (Optional)</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600"
                    value={selectedModule}
                    onChange={e => handleModuleSelect(e.target.value)}
                  >
                    <option value="">-- Select a module or enter custom --</option>
                    {Object.entries(getModulesByGroup()).map(([group, modules]) => (
                      <optgroup key={group} label={group}>
                        {modules.map(mod => (
                          <option key={mod.key} value={mod.key}>{mod.label} ({mod.url})</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-2">
                <Label>Link to Page (Optional)</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600"
                  value={menuFormData.page_id || ''}
                  onChange={e => handlePageSelect(e.target.value)}
                >
                  <option value="">-- No Page Linked --</option>
                  {pages.map(p => (
                    <option key={p.id} value={p.id}>{p.title} ({p.slug})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Label</Label>
                  <Input
                    value={menuFormData.label}
                    onChange={e => setMenuFormData({ ...menuFormData, label: e.target.value })}
                    placeholder="e.g. About Us"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Internal Name</Label>
                  <Input
                    value={menuFormData.name}
                    onChange={e => setMenuFormData({ ...menuFormData, name: e.target.value })}
                    placeholder="about_us"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>URL Path</Label>
                <Input
                  value={menuFormData.url}
                  onChange={e => setMenuFormData({ ...menuFormData, url: e.target.value })}
                  placeholder="e.g. /about or https://google.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Parent Menu</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600"
                  value={menuFormData.parent_id || ''}
                  onChange={e => setMenuFormData({ ...menuFormData, parent_id: e.target.value || null })}
                >
                  <option value="">No Parent (Top Level)</option>
                  {flatMenus.filter(m => m.id !== editingMenu?.id && !m.parent_id).map(m => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>

              {/* Location Override (Optional) */}
              <div className="space-y-2">
                <Label>Location</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600"
                  value={menuFormData.location || currentLocation}
                  onChange={e => setMenuFormData({ ...menuFormData, location: e.target.value })}
                >
                  {MENU_LOCATIONS.map(loc => (
                    <option key={loc.id} value={loc.id}>{loc.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-6 pt-2">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={menuFormData.is_active === true}
                    onChange={e => setMenuFormData({ ...menuFormData, is_active: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Active
                </label>
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={menuFormData.is_public === true}
                    onChange={e => setMenuFormData({ ...menuFormData, is_public: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  Public Default
                </label>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsEditing(false)}>Cancel</Button>
                <Button type="submit">Save Changes</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Permissions Dialog */}
        <Dialog open={isPermEditorOpen} onOpenChange={setIsPermEditorOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Manage Access: {selectedMenuPerms?.label}</DialogTitle>
              <DialogDescription>
                Toggle which roles can view this menu item in the public interface.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-3 max-h-[300px] overflow-y-auto">
              {roles.map(role => (
                <div key={role.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <span className="font-medium text-slate-700">{role.name}</span>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={menuPermissions[role.id] || false}
                      onChange={e => setMenuPermissions({
                        ...menuPermissions,
                        [role.id]: e.target.checked
                      })}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs font-semibold text-slate-500 uppercase">Allow</span>
                  </label>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button onClick={savePermissions}>Save Permissions</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminPageLayout>
  );
}

const MenuReorderItem = ({ menu, canEdit, canDelete, onEdit, onDelete, onPerms, onChildReorder, isPlatformAdmin }) => {
  const hasChildren = menu.children && menu.children.length > 0;
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Reorder.Item value={menu} id={menu.id} className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden select-none">
      <div className="flex items-center p-3 gap-3 hover:bg-slate-50/50 transition-colors">
        <GripVertical className="w-5 h-5 text-slate-400 cursor-grab active:cursor-grabbing flex-shrink-0" />

        <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 overflow-hidden">
          {isPlatformAdmin && (
            <span className="text-[10px] font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
              {menu.tenant?.name || '(Unknown)'}
            </span>
          )}
          <div className="font-bold text-slate-800 flex items-center gap-2 truncate">
            {menu.label}
            {!menu.is_active && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded border border-red-200">Inactive</span>}
          </div>
          <div className="flex items-center gap-2">
            {menu.page_id && <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded border border-indigo-100">Page Linked</span>}
            <span className="text-xs font-mono text-slate-400 truncate">{menu.url}</span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {hasChildren && (
            <Button variant="ghost" size="sm" onClick={() => setIsOpen(!isOpen)} className="h-8 w-8 p-0 mr-1">
              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onPerms(menu)} title="Access Permissions" className="h-8 w-8 p-0 text-slate-400 hover:text-slate-600">
            <Lock className="w-4 h-4" />
          </Button>
          {canEdit && (
            <Button variant="ghost" size="sm" onClick={() => onEdit(menu)} className="h-8 w-8 p-0 text-blue-600 hover:bg-blue-50">
              <Edit className="w-4 h-4" />
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" size="sm" onClick={() => onDelete(menu.id)} className="h-8 w-8 p-0 text-red-600 hover:bg-red-50">
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {hasChildren && isOpen && (
        <div className="pl-10 pr-3 pb-3 pt-1 bg-slate-50/30 border-t border-slate-100">
          {/* Recursive Reorder Group for Children */}
          <Reorder.Group axis="y" values={menu.children} onReorder={onChildReorder} className="space-y-2">
            {menu.children.map(child => (
              <Reorder.Item key={child.id} value={child} id={child.id} className="bg-white border border-slate-200 p-2 rounded flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-3">
                  <GripVertical className="w-4 h-4 text-slate-300 cursor-grab" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-slate-700">{child.label}</span>
                    <div className="flex items-center gap-2">
                      {child.page_id && <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded border border-indigo-100">Page</span>}
                      <span className="text-xs text-slate-400">{child.url}</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onPerms(child)}><Lock className="w-3 h-3 text-slate-400" /></Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onEdit(child)}><Edit className="w-3 h-3 text-blue-600" /></Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onDelete(child.id)}><Trash2 className="w-3 h-3 text-red-600" /></Button>
                </div>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        </div>
      )}
    </Reorder.Item>
  );
};

export default MenusManager;
