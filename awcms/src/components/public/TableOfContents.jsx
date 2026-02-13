
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

const TableOfContents = ({ content }) => {
  const [headings, setHeadings] = useState([]);
  const [activeId, setActiveId] = useState('');

  useEffect(() => {
    // Parse content HTML string to find headings
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
    const elements = doc.querySelectorAll('h2, h3');

    const items = Array.from(elements).map((element, index) => {
      const id = element.id || `heading-${index}`;
      // Note: In a real implementation, we'd need to inject these IDs back into the rendered content 
      // or ensure the RichTextEditor adds IDs. For now, we simulate extraction.
      return {
        id,
        text: element.textContent,
        level: Number(element.tagName.substring(1))
      };
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHeadings(items);
  }, [content]);

  if (headings.length === 0) return null;

  const handleClick = (e, id) => {
    e.preventDefault();
    // This assumes the rendered content has matching IDs. 
    // Since basic RichText usually doesn't add IDs automatically, 
    // this is a "best effort" scroll or would require modifying the content renderer.
    // For this implementation, we will try to find by text content if ID fails.
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
      setActiveId(id);
    } else {
      // Fallback: finding element containing text
      const found = Array.from(document.querySelectorAll('h2, h3'))
        .find(el => el.textContent === headings.find(h => h.id === id)?.text);
      if (found) {
        found.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  return (
    <div className="bg-slate-50/50 rounded-xl p-5 border border-slate-200">
      <h4 className="font-semibold text-slate-900 mb-4 text-sm uppercase tracking-wider">Table of Contents</h4>
      <nav className="space-y-1">
        {headings.map((heading) => (
          <a
            key={heading.id}
            href={`#${heading.id}`}
            onClick={(e) => handleClick(e, heading.id)}
            className={cn(
              "block text-sm transition-colors py-1 hover:text-blue-600",
              heading.level === 3 ? "pl-4 text-slate-500" : "text-slate-700 font-medium",
              activeId === heading.id && "text-blue-600"
            )}
          >
            {heading.text}
          </a>
        ))}
      </nav>
    </div>
  );
};

export default TableOfContents;
