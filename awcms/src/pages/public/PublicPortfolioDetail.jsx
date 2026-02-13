
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { Calendar, User, Tag, ArrowLeft } from 'lucide-react';
import SeoHelmet from '@/components/public/SeoHelmet';
import { Badge } from '@/components/ui/badge';

function PublicPortfolioDetail() {
  const { slug } = useParams();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDetail = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('portfolio')
        .select(`*, categories(name)`)
        .eq('slug', slug)
        .eq('status', 'published')
        .maybeSingle();

      if (!error && data) {
        setProject(data);
      }
      setLoading(false);
    };
    fetchDetail();
  }, [slug]);

  if (loading) return <div className="py-20 text-center">Loading project...</div>;

  if (!project) return (
    <div className="py-20 text-center">
      <h2 className="text-2xl font-bold text-slate-800">Project Not Found</h2>
      <Link to="/portfolio" className="text-blue-600 mt-4 inline-block">Back to portfolio</Link>
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <SeoHelmet
        type="portfolio_detail"
        id={project.id}
        defaultTitle={`${project.title} | Portfolio`}
        defaultDescription={project.description?.substring(0, 150) || ''}
      />

      <Link to="/portfolio" className="inline-flex items-center text-sm text-slate-500 hover:text-blue-600 transition-colors mb-8">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Portfolio
      </Link>

      <div className="mb-10">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {project.categories && <Badge>{project.categories.name}</Badge>}
          {project.project_date && (
            <span className="text-sm text-slate-500 flex items-center gap-1">
              <Calendar className="w-4 h-4" /> {new Date(project.project_date).toLocaleDateString()}
            </span>
          )}
        </div>
        <h1 className="text-4xl md:text-5xl font-bold text-slate-900 mb-6">{project.title}</h1>

        {project.client && (
          <div className="flex items-center gap-2 text-lg text-slate-600 mb-8">
            <User className="w-5 h-5" /> Client: <span className="font-semibold text-slate-900">{project.client}</span>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 mb-12">
        <h3 className="font-bold text-xl mb-4">Project Overview</h3>
        <div className="prose prose-slate max-w-none text-slate-600 leading-relaxed">
          {project.description}
        </div>
      </div>

      {/* Tags */}
      {project.tags && project.tags.length > 0 && ( // Assuming tags are stored as array or jsonb list
        <div className="flex flex-wrap gap-2">
          {/* If tags is array of strings or objects, adjust mapping */}
          {/* For simplicity, assuming standard text array for now if migrated, or handle jsonb if using jsonb tags column */}
          {Array.isArray(project.tags) && project.tags.map((tag, i) => (
            <Badge key={i} variant="secondary" className="text-slate-600 bg-slate-100">
              <Tag className="w-3 h-3 mr-1" /> {typeof tag === 'string' ? tag : tag.name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export default PublicPortfolioDetail;
