/**
 * Visual Page Renderer
 * Renders published visual builder content on public pages
 */

import { Render } from '@puckeditor/core';
import puckConfig from './config';

const VisualPageRenderer = ({ content }) => {
    // If no content or empty, show placeholder
    if (!content || !content.content || content.content.length === 0) {
        return (
            <div className="min-h-[400px] flex items-center justify-center bg-slate-50">
                <p className="text-slate-400">No content available</p>
            </div>
        );
    }

    return (
        <div className="visual-page-content">
            <Render config={puckConfig} data={content} />
        </div>
    );
};

export default VisualPageRenderer;
