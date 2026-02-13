
import { Facebook, Twitter, Linkedin, Link as LinkIcon, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

const ShareButtons = ({ url, title, description }) => {
  const { toast } = useToast();
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  const encodedDesc = encodeURIComponent(description || '');

  const handleCopyLink = () => {
    navigator.clipboard.writeText(url);
    toast({ title: "Link copied", description: "Page URL copied to clipboard." });
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="icon"
        className="rounded-full hover:text-blue-600 hover:bg-blue-50 border-slate-200"
        onClick={() => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`, '_blank')}
        title="Share on Facebook"
      >
        <Facebook className="w-4 h-4" />
      </Button>

      <Button
        variant="outline"
        size="icon"
        className="rounded-full hover:text-sky-500 hover:bg-sky-50 border-slate-200"
        onClick={() => window.open(`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`, '_blank')}
        title="Share on Twitter"
      >
        <Twitter className="w-4 h-4" />
      </Button>

      <Button
        variant="outline"
        size="icon"
        className="rounded-full hover:text-blue-700 hover:bg-blue-50 border-slate-200"
        onClick={() => window.open(`https://www.linkedin.com/shareArticle?mini=true&url=${encodedUrl}&title=${encodedTitle}&summary=${encodedDesc}`, '_blank')}
        title="Share on LinkedIn"
      >
        <Linkedin className="w-4 h-4" />
      </Button>

      <Button
        variant="outline"
        size="icon"
        className="rounded-full hover:text-slate-800 hover:bg-slate-100 border-slate-200"
        onClick={() => window.open(`mailto:?subject=${encodedTitle}&body=Check out this page: ${encodedUrl}`, '_blank')}
        title="Share via Email"
      >
        <Mail className="w-4 h-4" />
      </Button>

      <Button
        variant="outline"
        size="icon"
        className="rounded-full hover:text-slate-800 hover:bg-slate-100 border-slate-200"
        onClick={handleCopyLink}
        title="Copy Link"
      >
        <LinkIcon className="w-4 h-4" />
      </Button>
    </div>
  );
};

export default ShareButtons;
