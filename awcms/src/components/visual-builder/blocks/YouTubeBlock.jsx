
export const YouTubeBlock = ({ url, aspectRatio = '16/9', autoplay = false }) => {
    // Helper to extract Video ID
    const getVideoId = (url) => {
        if (!url) return null;
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    };

    const videoId = getVideoId(url);
    const ratio = aspectRatio.split('/');
    const paddingBottom = `${(ratio[1] / ratio[0]) * 100}%`;

    if (!videoId) {
        return (
            <div className="aspect-video flex items-center justify-center bg-slate-100 rounded-lg border-2 border-dashed border-slate-300 text-slate-400">
                Enter a valid YouTube URL
            </div>
        );
    }

    const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=${autoplay ? 1 : 0}&mute=${autoplay ? 1 : 0}`;

    return (
        <div className="w-full relative rounded-lg overflow-hidden shadow-sm" style={{ paddingBottom }}>
            <iframe
                className="absolute top-0 left-0 w-full h-full"
                src={embedUrl}
                title="YouTube video player"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
            />
        </div>
    );
};

export const YouTubeBlockFields = {
    url: { type: 'text', label: 'YouTube URL' },
    aspectRatio: {
        type: 'select',
        label: 'Aspect Ratio',
        options: [
            { label: '16:9 (Standard)', value: '16/9' },
            { label: '4:3 (Classic)', value: '4/3' },
            { label: '21:9 (Cinematic)', value: '21/9' }
        ]
    },
    autoplay: {
        type: 'radio',
        label: 'Autoplay (Muted)',
        options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false }
        ]
    }
};
