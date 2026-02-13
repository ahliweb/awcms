import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts/TenantContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import LocalizedInput from '@/components/ui/LocalizedInput';
import LocalizedArrayEditor from '@/components/ui/LocalizedArrayEditor';
import { PositionArrayEditor, StaffArrayEditor } from '@/components/ui/PositionArrayEditor';
import ImageUpload from '@/components/ui/ImageUpload';
import {
    School,
    Save,
    RefreshCw,
    Building2,
    Users,
    GraduationCap,
    Trophy,
    UserCheck,
    Wallet,
    Image,
    CalendarDays,
    Phone,
    Loader2,
    Plus,
    Trash2
} from 'lucide-react';

const SETTINGS_KEYS = {
    profile: 'page_profile',
    organization: 'page_organization',
    staff: 'page_staff',
    services: 'page_services',
    achievements: 'page_achievements',
    alumni: 'page_alumni',
    finance: 'page_finance',
    gallery: 'page_gallery',
    agenda: 'page_agenda',
    contact: 'page_contact'
};

function SchoolPagesManager() {
    useTranslation();
    const { currentTenant } = useTenant();
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState('profile');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [data, setData] = useState({});
    const [hasChanges, setHasChanges] = useState(false);

    const tenantId = currentTenant?.id;

    // Load all settings data
    const loadData = useCallback(async () => {
        if (!tenantId) return;
        setLoading(true);
        try {
            const { data: settings, error } = await supabase
                .from('settings')
                .select('key, value')
                .eq('tenant_id', tenantId)
                .in('key', Object.values(SETTINGS_KEYS));

            if (error) throw error;

            const loaded = {};
            settings?.forEach((s) => {
                const parsed = typeof s.value === 'string' ? JSON.parse(s.value) : s.value;
                const keyName = Object.keys(SETTINGS_KEYS).find(k => SETTINGS_KEYS[k] === s.key);
                if (keyName) loaded[keyName] = parsed;
            });
            setData(loaded);
        } catch (err) {
            console.error('Error loading school pages data:', err);
            toast({ title: 'Error', description: 'Failed to load data', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [tenantId, toast]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Save current tab data
    const handleSave = async () => {
        if (!tenantId) return;
        setSaving(true);
        try {
            const key = SETTINGS_KEYS[activeTab];
            const value = data[activeTab] || {};

            const { error } = await supabase
                .from('settings')
                .upsert({
                    tenant_id: tenantId,
                    key,
                    value: JSON.stringify(value),
                    type: 'json'
                }, { onConflict: 'tenant_id,key' });

            if (error) throw error;

            toast({ title: 'Saved', description: `${activeTab} data saved successfully` });
            setHasChanges(false);
        } catch (err) {
            console.error('Error saving:', err);
            toast({ title: 'Error', description: 'Failed to save data', variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    // Update data for current tab
    const updateField = (section, field, value) => {
        setData(prev => ({
            ...prev,
            [activeTab]: {
                ...prev[activeTab],
                [section]: {
                    ...prev[activeTab]?.[section],
                    [field]: value
                }
            }
        }));
        setHasChanges(true);
    };

    const updateTopLevel = (field, value) => {
        setData(prev => ({
            ...prev,
            [activeTab]: {
                ...prev[activeTab],
                [field]: value
            }
        }));
        setHasChanges(true);
    };

    const tabs = [
        { id: 'profile', label: 'Profile', icon: Building2 },
        { id: 'organization', label: 'Organization', icon: Users },
        { id: 'staff', label: 'Staff', icon: UserCheck },
        { id: 'services', label: 'Services', icon: GraduationCap },
        { id: 'achievements', label: 'Achievements', icon: Trophy },
        { id: 'alumni', label: 'Alumni', icon: GraduationCap },
        { id: 'finance', label: 'Finance', icon: Wallet },
        { id: 'gallery', label: 'Gallery', icon: Image },
        { id: 'agenda', label: 'Agenda', icon: CalendarDays },
        { id: 'contact', label: 'Contact', icon: Phone }
    ];

    if (loading) {
        return (
            <AdminPageLayout requiredPermission={['tenant.school_pages.read', 'platform.school_pages.read']}>
                <PageHeader
                    title="School Website Pages"
                    description="Manage content for your school's public website"
                    icon={School}
                    breadcrumbs={[{ label: 'School Pages', icon: School }]}
                />
                <div className="space-y-4 p-6">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-64 w-full" />
                </div>
            </AdminPageLayout>
        );
    }

    return (
        <AdminPageLayout requiredPermission={['tenant.school_pages.read', 'platform.school_pages.read']}>
            <PageHeader
                title="School Website Pages"
                description="Manage content for your school's public website"
                icon={School}
                breadcrumbs={[{ label: 'School Pages', icon: School }]}
                actions={[
                    <Button
                        key="refresh"
                        variant="outline"
                        size="sm"
                        onClick={loadData}
                        disabled={loading}
                    >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh
                    </Button>,
                    <Button
                        key="save"
                        size="sm"
                        onClick={handleSave}
                        disabled={saving || !hasChanges}
                    >
                        {saving ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                            <Save className="h-4 w-4 mr-2" />
                        )}
                        Save Changes
                    </Button>
                ]}
            />

            <div className="p-6">
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList className="grid grid-cols-5 lg:grid-cols-10 h-auto gap-1 p-1">
                        {tabs.map((tab) => (
                            <TabsTrigger
                                key={tab.id}
                                value={tab.id}
                                className="flex flex-col items-center gap-1 py-2 px-3 text-xs"
                            >
                                <tab.icon className="h-4 w-4" />
                                <span className="hidden sm:inline">{tab.label}</span>
                            </TabsTrigger>
                        ))}
                    </TabsList>

                    {/* Profile Tab */}
                    <TabsContent value="profile" className="mt-6 space-y-6">
                        <ProfileEditor data={data.profile} updateField={updateField} updateTopLevel={updateTopLevel} />
                    </TabsContent>

                    {/* Organization Tab */}
                    <TabsContent value="organization" className="mt-6 space-y-6">
                        <OrganizationEditor data={data.organization} updateField={updateField} updateTopLevel={updateTopLevel} />
                    </TabsContent>

                    {/* Staff Tab */}
                    <TabsContent value="staff" className="mt-6 space-y-6">
                        <StaffEditor data={data.staff} updateField={updateField} updateTopLevel={updateTopLevel} />
                    </TabsContent>

                    {/* Services Tab */}
                    <TabsContent value="services" className="mt-6 space-y-6">
                        <ServicesEditor data={data.services} updateField={updateField} updateTopLevel={updateTopLevel} />
                    </TabsContent>

                    {/* Achievements Tab */}
                    <TabsContent value="achievements" className="mt-6 space-y-6">
                        <AchievementsEditor data={data.achievements} updateField={updateField} updateTopLevel={updateTopLevel} />
                    </TabsContent>

                    {/* Alumni Tab */}
                    <TabsContent value="alumni" className="mt-6 space-y-6">
                        <AlumniEditor data={data.alumni} updateField={updateField} updateTopLevel={updateTopLevel} />
                    </TabsContent>

                    {/* Finance Tab */}
                    <TabsContent value="finance" className="mt-6 space-y-6">
                        <FinanceEditor data={data.finance} updateField={updateField} updateTopLevel={updateTopLevel} />
                    </TabsContent>

                    {/* Gallery Tab */}
                    <TabsContent value="gallery" className="mt-6 space-y-6">
                        <GalleryEditor data={data.gallery} updateField={updateField} updateTopLevel={updateTopLevel} />
                    </TabsContent>

                    {/* Agenda Tab */}
                    <TabsContent value="agenda" className="mt-6 space-y-6">
                        <AgendaEditor data={data.agenda} updateField={updateField} updateTopLevel={updateTopLevel} />
                    </TabsContent>

                    {/* Contact Tab */}
                    <TabsContent value="contact" className="mt-6 space-y-6">
                        <ContactEditor data={data.contact} updateField={updateField} updateTopLevel={updateTopLevel} />
                    </TabsContent>
                </Tabs>
            </div>
        </AdminPageLayout>
    );
}

// ============ SUB-EDITORS ============

function ProfileEditor({ data = {}, updateField }) {
    return (
        <div className="grid gap-6">
            {/* Principal Message */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Principal Message</CardTitle>
                    <CardDescription>Welcome message from the school principal</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <LocalizedInput
                        label="Title"
                        value={data.principalMessage?.title}
                        onChange={(v) => updateField('principalMessage', 'title', v)}
                    />
                    <LocalizedInput
                        label="Content"
                        type="richtext"
                        value={data.principalMessage?.content}
                        onChange={(v) => updateField('principalMessage', 'content', v)}
                    />
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label>Author Name</Label>
                            <Input
                                value={data.principalMessage?.author || ''}
                                onChange={(e) => updateField('principalMessage', 'author', e.target.value)}
                                placeholder="Principal's name"
                            />
                        </div>
                        <div>
                            <Label>Position</Label>
                            <Input
                                value={data.principalMessage?.position || ''}
                                onChange={(e) => updateField('principalMessage', 'position', e.target.value)}
                                placeholder="e.g., Kepala Sekolah"
                            />
                        </div>
                    </div>
                    <ImageUpload
                        label="Principal Photo"
                        value={data.principalMessage?.image}
                        onChange={(v) => updateField('principalMessage', 'image', v)}
                    />
                </CardContent>
            </Card>

            {/* Vision & Mission */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Vision & Mission</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <LocalizedInput
                        label="Vision"
                        type="textarea"
                        value={data.visionMission?.vision}
                        onChange={(v) => updateField('visionMission', 'vision', v)}
                    />
                    <LocalizedArrayEditor
                        label="Mission Statements"
                        itemLabel="Mission"
                        addLabel="Add Mission"
                        value={data.visionMission?.mission}
                        onChange={(v) => updateField('visionMission', 'mission', v)}
                    />
                    <LocalizedInput
                        label="Motto"
                        value={data.visionMission?.motto}
                        onChange={(v) => updateField('visionMission', 'motto', v)}
                    />
                </CardContent>
            </Card>

            {/* History */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">School History</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <LocalizedInput
                        label="History Content"
                        type="richtext"
                        value={data.history?.content}
                        onChange={(v) => updateField('history', 'content', v)}
                    />
                </CardContent>
            </Card>
        </div>
    );
}

function OrganizationEditor({ data = {}, updateField: _updateField, updateTopLevel }) {
    const [activeOrg, setActiveOrg] = useState('school');

    const orgTypes = [
        { id: 'school', label: 'School Structure', key: 'schoolOrganization' },
        { id: 'committee', label: 'Committee', key: 'committeeOrganization' },
        { id: 'osis', label: 'OSIS', key: 'osisOrganization' },
        { id: 'mpk', label: 'MPK', key: 'mpkOrganization' }
    ];

    const currentOrg = orgTypes.find(o => o.id === activeOrg);
    const currentData = data?.[currentOrg?.key] || {};

    const handleOrgChange = (field, value) => {
        updateTopLevel(currentOrg.key, {
            ...currentData,
            [field]: value
        });
    };

    return (
        <div className="space-y-4">
            <Tabs value={activeOrg} onValueChange={setActiveOrg}>
                <TabsList className="grid grid-cols-4 w-full">
                    {orgTypes.map((org) => (
                        <TabsTrigger key={org.id} value={org.id}>{org.label}</TabsTrigger>
                    ))}
                </TabsList>

                {orgTypes.map((org) => (
                    <TabsContent key={org.id} value={org.id} className="mt-4 space-y-4">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">{org.label}</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <LocalizedInput
                                    label="Title"
                                    value={data?.[org.key]?.title}
                                    onChange={(v) => handleOrgChange('title', v)}
                                />
                                {(org.id === 'committee' || org.id === 'osis' || org.id === 'mpk') && (
                                    <div>
                                        <Label>Period</Label>
                                        <Input
                                            value={data?.[org.key]?.period || ''}
                                            onChange={(e) => handleOrgChange('period', e.target.value)}
                                            placeholder="e.g., 2024/2025"
                                        />
                                    </div>
                                )}
                                <PositionArrayEditor
                                    label="Positions"
                                    value={data?.[org.key]?.positions || []}
                                    onChange={(v) => handleOrgChange('positions', v)}
                                    showPhoto={org.id === 'school'}
                                    showClass={org.id === 'osis' || org.id === 'mpk'}
                                />
                                {org.id === 'mpk' && (
                                    <LocalizedInput
                                        label="Description"
                                        type="textarea"
                                        value={data?.[org.key]?.description}
                                        onChange={(v) => handleOrgChange('description', v)}
                                    />
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    );
}

function StaffEditor({ data = {}, updateField: _updateField, updateTopLevel }) {
    const [activeStaff, setActiveStaff] = useState('teachers');

    return (
        <div className="space-y-4">
            <Tabs value={activeStaff} onValueChange={setActiveStaff}>
                <TabsList className="grid grid-cols-2 w-[400px]">
                    <TabsTrigger value="teachers">Teaching Staff</TabsTrigger>
                    <TabsTrigger value="admin">Administrative Staff</TabsTrigger>
                </TabsList>

                <TabsContent value="teachers" className="mt-4 space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Teaching Council</CardTitle>
                            <CardDescription>Manage teacher roster with roles and subjects</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <LocalizedInput
                                label="Section Title"
                                value={data?.teachingStaff?.title}
                                onChange={(v) => updateTopLevel('teachingStaff', { ...data?.teachingStaff, title: v })}
                            />
                            <LocalizedInput
                                label="Description"
                                type="textarea"
                                value={data?.teachingStaff?.description}
                                onChange={(v) => updateTopLevel('teachingStaff', { ...data?.teachingStaff, description: v })}
                            />
                            <StaffArrayEditor
                                label="Staff Members"
                                value={data?.teachingStaff?.staff || []}
                                onChange={(v) => updateTopLevel('teachingStaff', { ...data?.teachingStaff, staff: v })}
                                showSubject={true}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="admin" className="mt-4 space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Administrative Staff</CardTitle>
                            <CardDescription>Non-teaching support staff</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <LocalizedInput
                                label="Section Title"
                                value={data?.administrativeStaff?.title}
                                onChange={(v) => updateTopLevel('administrativeStaff', { ...data?.administrativeStaff, title: v })}
                            />
                            <StaffArrayEditor
                                label="Staff Members"
                                value={data?.administrativeStaff?.staff || []}
                                onChange={(v) => updateTopLevel('administrativeStaff', { ...data?.administrativeStaff, staff: v })}
                                showSubject={false}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}

function ServicesEditor({ data = {}, updateField }) {
    return (
        <div className="grid gap-6">
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Library</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <LocalizedInput
                        label="Title"
                        value={data.library?.title}
                        onChange={(v) => updateField('library', 'title', v)}
                    />
                    <LocalizedInput
                        label="Content"
                        type="richtext"
                        value={data.library?.content}
                        onChange={(v) => updateField('library', 'content', v)}
                    />
                </CardContent>
            </Card>
        </div>
    );
}

function AchievementsEditor({ data = {}, updateField }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">School Achievements</CardTitle>
                <CardDescription>Awards, competitions, and recognitions</CardDescription>
            </CardHeader>
            <CardContent>
                <LocalizedInput
                    label="Page Description"
                    type="textarea"
                    value={data.achievementsPage?.description}
                    onChange={(v) => updateField('achievementsPage', 'description', v)}
                />
            </CardContent>
        </Card>
    );
}

function AlumniEditor({ data = {}, updateField }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">Alumni</CardTitle>
                <CardDescription>Featured alumni and association info</CardDescription>
            </CardHeader>
            <CardContent>
                <LocalizedInput
                    label="Page Description"
                    type="textarea"
                    value={data.alumniPage?.description}
                    onChange={(v) => updateField('alumniPage', 'description', v)}
                />
            </CardContent>
        </Card>
    );
}

function FinanceEditor({ data = {}, updateField }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">Financial Transparency</CardTitle>
                <CardDescription>BOS, APBD, and Committee reports</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <LocalizedInput
                    label="BOS Report Content"
                    type="richtext"
                    value={data.bos?.content}
                    onChange={(v) => updateField('bos', 'content', v)}
                />
            </CardContent>
        </Card>
    );
}

function GalleryEditor({ data = {}, updateField: _updateField, updateTopLevel }) {
    const [albums, setAlbums] = useState(data?.albums || []);

    const handleAlbumsChange = (newAlbums) => {
        setAlbums(newAlbums);
        updateTopLevel('albums', newAlbums);
    };

    const addAlbum = () => {
        handleAlbumsChange([...albums, {
            id: `album-${Date.now()}`,
            title: { id: '', en: '' },
            description: { id: '', en: '' },
            coverImage: '',
            images: []
        }]);
    };

    const updateAlbum = (index, field, value) => {
        const updated = albums.map((album, i) =>
            i === index ? { ...album, [field]: value } : album
        );
        handleAlbumsChange(updated);
    };

    const removeAlbum = (index) => {
        handleAlbumsChange(albums.filter((_, i) => i !== index));
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-medium">Photo Gallery Albums</h3>
                    <p className="text-sm text-muted-foreground">Create and manage gallery albums</p>
                </div>
                <Button onClick={addAlbum} variant="outline" size="sm">
                    <Plus className="h-4 w-4 mr-1" /> Add Album
                </Button>
            </div>

            {albums.length === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="py-8 text-center text-muted-foreground">
                        No albums created yet. Click &quot;Add Album&quot; to create one.
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4">
                    {albums.map((album, index) => (
                        <Card key={album.id || index}>
                            <CardHeader className="flex flex-row items-start justify-between">
                                <div>
                                    <CardTitle className="text-base">
                                        {album.title?.id || album.title?.en || `Album ${index + 1}`}
                                    </CardTitle>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-destructive"
                                    onClick={() => removeAlbum(index)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <LocalizedInput
                                    label="Album Title"
                                    value={album.title}
                                    onChange={(v) => updateAlbum(index, 'title', v)}
                                />
                                <LocalizedInput
                                    label="Description"
                                    type="textarea"
                                    value={album.description}
                                    onChange={(v) => updateAlbum(index, 'description', v)}
                                />
                                <ImageUpload
                                    label="Cover Image"
                                    value={album.coverImage}
                                    onChange={(v) => updateAlbum(index, 'coverImage', v)}
                                />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}

function AgendaEditor({ data = {}, updateField: _updateField, updateTopLevel }) {
    const [events, setEvents] = useState(data?.events || []);

    const handleEventsChange = (newEvents) => {
        setEvents(newEvents);
        updateTopLevel('events', newEvents);
    };

    const addEvent = () => {
        handleEventsChange([...events, {
            id: `event-${Date.now()}`,
            title: { id: '', en: '' },
            description: { id: '', en: '' },
            date: '',
            endDate: '',
            location: '',
            isAllDay: false
        }]);
    };

    const updateEvent = (index, field, value) => {
        const updated = events.map((event, i) =>
            i === index ? { ...event, [field]: value } : event
        );
        handleEventsChange(updated);
    };

    const removeEvent = (index) => {
        handleEventsChange(events.filter((_, i) => i !== index));
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-medium">School Agenda</h3>
                    <p className="text-sm text-muted-foreground">Manage upcoming events and activities</p>
                </div>
                <Button onClick={addEvent} variant="outline" size="sm">
                    <Plus className="h-4 w-4 mr-1" /> Add Event
                </Button>
            </div>

            {events.length === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="py-8 text-center text-muted-foreground">
                        No events scheduled. Click &quot;Add Event&quot; to create one.
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4">
                    {events.map((event, index) => (
                        <Card key={event.id || index}>
                            <CardHeader className="flex flex-row items-start justify-between pb-2">
                                <div>
                                    <CardTitle className="text-base">
                                        {event.title?.id || event.title?.en || `Event ${index + 1}`}
                                    </CardTitle>
                                    {event.date && (
                                        <CardDescription>{event.date}{event.endDate ? ` - ${event.endDate}` : ''}</CardDescription>
                                    )}
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-destructive"
                                    onClick={() => removeEvent(index)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <LocalizedInput
                                    label="Event Title"
                                    value={event.title}
                                    onChange={(v) => updateEvent(index, 'title', v)}
                                />
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label>Start Date</Label>
                                        <Input
                                            type="date"
                                            value={event.date || ''}
                                            onChange={(e) => updateEvent(index, 'date', e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <Label>End Date (optional)</Label>
                                        <Input
                                            type="date"
                                            value={event.endDate || ''}
                                            onChange={(e) => updateEvent(index, 'endDate', e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <Label>Location</Label>
                                    <Input
                                        value={event.location || ''}
                                        onChange={(e) => updateEvent(index, 'location', e.target.value)}
                                        placeholder="Event location"
                                    />
                                </div>
                                <LocalizedInput
                                    label="Description"
                                    type="textarea"
                                    value={event.description}
                                    onChange={(v) => updateEvent(index, 'description', v)}
                                />
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}

function ContactEditor({ data = {}, updateField }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-lg">Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <LocalizedInput
                    label="Address"
                    type="textarea"
                    value={data.contactInfo?.address}
                    onChange={(v) => updateField('contactInfo', 'address', v)}
                />
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <Label>Phone</Label>
                        <Input
                            value={data.contactInfo?.phone || ''}
                            onChange={(e) => updateField('contactInfo', 'phone', e.target.value)}
                            placeholder="Phone number"
                        />
                    </div>
                    <div>
                        <Label>Email</Label>
                        <Input
                            value={data.contactInfo?.email || ''}
                            onChange={(e) => updateField('contactInfo', 'email', e.target.value)}
                            placeholder="Email address"
                        />
                    </div>
                </div>
                <LocalizedInput
                    label="Operational Hours"
                    value={data.contactInfo?.operationalHours}
                    onChange={(v) => updateField('contactInfo', 'operationalHours', v)}
                />
                <div>
                    <Label>Google Maps Embed URL</Label>
                    <Input
                        value={data.mapEmbed || ''}
                        onChange={(e) => updateField('mapEmbed', e.target.value)}
                        placeholder="https://maps.google.com/..."
                    />
                </div>
            </CardContent>
        </Card>
    );
}

export default SchoolPagesManager;
