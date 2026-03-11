import { useState } from 'react';
import { Plus, Search, Trash2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { useTemplates } from '@/hooks/useTemplates';

const TemplateLanguageManager = () => {
	const { templateStrings, updateTemplateString, deleteTemplateString } = useTemplates();
	const [searchQuery, setSearchQuery] = useState('');
	const [isAddOpen, setIsAddOpen] = useState(false);

	const filteredStrings = templateStrings.filter((item) =>
		item.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
		item.value?.toLowerCase().includes(searchQuery.toLowerCase())
	);

	return (
		<div className="space-y-6">
			<div className="rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-sm">
				<div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
					<div>
						<h3 className="text-lg font-medium text-foreground">Template Translations</h3>
						<p className="text-sm text-muted-foreground">Manage text strings used in templates.</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<span className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs font-medium text-muted-foreground">
							{filteredStrings.length} strings
						</span>
						<Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
							<DialogTrigger asChild>
								<Button className="h-10 rounded-xl bg-primary px-4 text-primary-foreground shadow-sm hover:opacity-95">
									<Plus className="mr-2 h-4 w-4" /> Add Translation
								</Button>
							</DialogTrigger>
							<DialogContent className="border-border/60">
								<AddTranslationForm onClose={() => setIsAddOpen(false)} onSave={updateTemplateString} />
							</DialogContent>
						</Dialog>
					</div>
				</div>
			</div>

			<div className="relative w-full max-w-sm">
				<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					placeholder="Search keys or values..."
					value={searchQuery}
					onChange={(event) => setSearchQuery(event.target.value)}
					className="h-10 rounded-xl border-border/70 pl-9"
				/>
			</div>

			<div className="overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm backdrop-blur-sm">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Key</TableHead>
							<TableHead>Locale</TableHead>
							<TableHead>Value</TableHead>
							<TableHead className="w-[100px]">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{filteredStrings.length === 0 ? (
							<TableRow>
								<TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
									No translations found.
								</TableCell>
							</TableRow>
						) : (
							filteredStrings.map((item) => (
								<TranslationRow
									key={item.id}
									item={item}
									onUpdate={updateTemplateString}
									onDelete={deleteTemplateString}
								/>
							))
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
};

const TranslationRow = ({ item, onUpdate, onDelete }) => {
	const [isEditing, setIsEditing] = useState(false);
	const [value, setValue] = useState(item.value || '');

	const handleSave = async () => {
		await onUpdate(item.id, { value });
		setIsEditing(false);
	};

	return (
		<TableRow>
			<TableCell className="font-mono text-xs text-muted-foreground">{item.key}</TableCell>
			<TableCell>
				<span className="inline-flex rounded border border-primary/25 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
					{item.locale?.toUpperCase()}
				</span>
			</TableCell>
			<TableCell>
				{isEditing ? (
					<div className="flex gap-2">
						<Input
							value={value}
							onChange={(event) => setValue(event.target.value)}
							className="h-8 rounded-lg border-border/70"
						/>
						<Button size="sm" onClick={handleSave} className="h-8 rounded-lg bg-primary px-2 text-primary-foreground hover:opacity-95">
							<Save className="h-4 w-4" />
						</Button>
					</div>
				) : (
					<div className="cursor-pointer rounded-lg px-2 py-1 text-sm hover:bg-accent/50" onClick={() => setIsEditing(true)}>
						{item.value || <span className="italic text-muted-foreground">Empty</span>}
					</div>
				)}
			</TableCell>
			<TableCell>
				<Button
					variant="ghost"
					size="sm"
					className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
					onClick={() => onDelete(item.id)}
				>
					<Trash2 className="h-4 w-4" />
				</Button>
			</TableCell>
		</TableRow>
	);
};

const AddTranslationForm = ({ onClose, onSave }) => {
	const [key, setKey] = useState('');
	const [locale, setLocale] = useState('en');
	const [value, setValue] = useState('');

	const handleSubmit = async (event) => {
		event.preventDefault();
		await onSave('new', { key, locale, value });
		onClose();
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<DialogHeader>
				<DialogTitle>Add Translation</DialogTitle>
			</DialogHeader>
			<div className="space-y-2">
				<Label>Key</Label>
				<Input
					placeholder="e.g., home.welcome_message"
					value={key}
					onChange={(event) => setKey(event.target.value)}
					required
					className="rounded-xl border-border/70"
				/>
			</div>
			<div className="space-y-2">
				<Label>Locale</Label>
				<Select value={locale} onValueChange={setLocale}>
					<SelectTrigger className="rounded-xl border-border/70">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="en">English (en)</SelectItem>
						<SelectItem value="id">Indonesian (id)</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<div className="space-y-2">
				<Label>Value</Label>
				<Input
					placeholder="Translated text..."
					value={value}
					onChange={(event) => setValue(event.target.value)}
					required
					className="rounded-xl border-border/70"
				/>
			</div>
			<div className="flex justify-end gap-2 pt-4">
				<Button type="button" variant="outline" onClick={onClose} className="rounded-xl border-border/70">
					Cancel
				</Button>
				<Button type="submit" className="rounded-xl bg-primary text-primary-foreground hover:opacity-95">
					Save
				</Button>
			</div>
		</form>
	);
};

export default TemplateLanguageManager;
