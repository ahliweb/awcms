
import { supabase } from '@/lib/customSupabaseClient';
import { User, Linkedin, Twitter, Github } from 'lucide-react';

export const TeamListBlock = ({
    showSocial = true,
    team = []
}) => {
    if (team.length === 0) {
        return (
            <div className="text-center p-8 bg-slate-50 text-slate-500 rounded-lg border border-dashed border-slate-300">
                No team members found.
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {team.map((member, index) => (
                <div key={member.id || index} className="group text-center">
                    <div className="relative inline-block mb-4">
                        <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-white shadow-lg mx-auto relative z-10">
                            {member.image ? (
                                <img
                                    src={member.image}
                                    alt={member.name}
                                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                />
                            ) : (
                                <div className="w-full h-full bg-slate-100 flex items-center justify-center text-slate-400">
                                    <User className="w-12 h-12" />
                                </div>
                            )}
                        </div>
                        <div className="absolute inset-0 rounded-full bg-blue-600 opacity-0 group-hover:opacity-10 transition-opacity z-0 transform scale-110"></div>
                    </div>

                    <h3 className="text-xl font-bold text-slate-900 mb-1">{member.name}</h3>
                    <p className="text-blue-600 font-medium text-sm mb-3">{member.title}</p>

                    {member.description && (
                        <p className="text-slate-600 text-sm mb-4 line-clamp-3 px-4">
                            {member.description}
                        </p>
                    )}

                    {showSocial && (
                        <div className="flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity translate-y-2 group-hover:translate-y-0 duration-300">
                            <button className="text-slate-400 hover:text-blue-600 transition-colors"><Twitter className="w-4 h-4" /></button>
                            <button className="text-slate-400 hover:text-blue-700 transition-colors"><Linkedin className="w-4 h-4" /></button>
                            <button className="text-slate-400 hover:text-slate-900 transition-colors"><Github className="w-4 h-4" /></button>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};

export const resolveTeamData = async ({ props }) => {
    const { count = 4 } = props;
    try {
        const { data, error } = await supabase
            .from('teams')
            .select('*')
            .eq('status', 'published')
            .order('display_order', { ascending: true })
            .limit(count);

        if (error) throw error;

        return {
            props: {
                ...props,
                team: data || []
            }
        };
    } catch (err) {
        console.error('Error resolving team data:', err);
        return { props: { ...props, team: [] } };
    }
};

export const TeamListBlockFields = {
    count: {
        type: 'number',
        label: 'Number of Members',
        min: 1,
        max: 20
    },
    showSocial: {
        type: 'radio',
        label: 'Show Social Links',
        options: [{ label: 'Yes', value: true }, { label: 'No', value: false }]
    }
};
