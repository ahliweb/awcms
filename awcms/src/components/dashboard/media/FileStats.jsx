
import { motion } from 'framer-motion';
import { FileText, Image, Film, HardDrive } from 'lucide-react';
import { formatBytes } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

function StatCard({ title, value, subValue, icon: Icon, color, loading }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm flex items-start justify-between"
    >
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-500">{title}</p>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <h3 className="text-2xl font-bold text-slate-900">{value}</h3>
        )}
        {subValue && !loading && (
          <p className="text-xs text-slate-400">{subValue}</p>
        )}
        {loading && subValue && (
          <Skeleton className="h-3 w-16 mt-1" />
        )}
      </div>
      <div className={`p-3 rounded-lg bg-${color}-50 text-${color}-600`}>
        <Icon className="w-5 h-5" />
      </div>
    </motion.div>
  );
}

export function FileStats({ stats, loading }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <StatCard
        title="Total Storage"
        value={formatBytes(stats.total_size)}
        icon={HardDrive}
        color="blue"
        loading={loading}
      />
      <StatCard
        title="Total Files"
        value={stats.total_files}
        icon={FileText}
        color="indigo"
        loading={loading}
      />
      <StatCard
        title="Images"
        value={stats.image_count}
        icon={Image}
        color="pink"
        loading={loading}
      />
      <StatCard
        title="Videos & Docs"
        value={stats.video_count + stats.doc_count}
        subValue={`${stats.video_count} videos, ${stats.doc_count} docs`}
        icon={Film}
        color="orange"
        loading={loading}
      />
    </div>
  );
}
