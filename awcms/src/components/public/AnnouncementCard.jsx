
import { motion } from 'framer-motion';
import { Calendar, Tag, AlertTriangle, Info, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Link } from 'react-router-dom';

const AnnouncementCard = ({ item, index }) => {
  const getPriorityStyles = (priority) => {
      switch(priority) {
          case 'urgent': return { color: 'bg-red-50 border-red-100', icon: AlertTriangle, badge: 'bg-red-100 text-red-700' };
          case 'high': return { color: 'bg-orange-50 border-orange-100', icon: AlertTriangle, badge: 'bg-orange-100 text-orange-700' };
          default: return { color: 'bg-blue-50 border-blue-100', icon: Info, badge: 'bg-blue-100 text-blue-700' };
      }
  };

  const styles = getPriorityStyles(item.priority);
  const Icon = styles.icon;

  return (
    <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.1 }}
        className={`p-6 rounded-2xl shadow-sm border hover:shadow-md transition-shadow flex gap-6 items-start ${styles.color}`}
    >
        <div className={`hidden md:flex flex-col items-center justify-center w-12 h-12 rounded-xl shrink-0 bg-white/60 border border-white/50`}>
            <Icon className="w-6 h-6 text-slate-600" />
        </div>
        
        <div className="flex-1">
          <div className="flex flex-wrap gap-2 mb-2 items-center">
              <Badge variant="outline" className={`uppercase tracking-wider ${styles.badge}`}>
                  {item.priority}
              </Badge>
              
              <span className="text-xs text-slate-500 flex items-center gap-1 ml-2">
                  <Calendar className="w-3 h-3" />
                  {new Date(item.created_at).toLocaleDateString()}
              </span>
              {item.categories && (
                  <Badge variant="secondary" className="flex items-center gap-1 bg-white/50 text-slate-600 border-slate-200">
                      <Tag className="w-3 h-3" />
                      {item.categories.name}
                  </Badge>
              )}
          </div>
          <h3 className="font-bold text-xl text-slate-900 mb-2">
            <Link to={`/announcements/${item.id}`} className="hover:underline">
              {item.title}
            </Link>
          </h3>
          <div className="text-slate-700 line-clamp-3 mb-3 leading-relaxed">{item.content}</div>
          
          <Link to={`/announcements/${item.id}`} className="text-sm font-medium text-slate-600 hover:text-blue-600 flex items-center gap-1">
             Read details <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
    </motion.div>
  );
};

export default AnnouncementCard;
