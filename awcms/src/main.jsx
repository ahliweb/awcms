
import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/index.css';
import '@/lib/i18n';
import { initTemplateExtensions } from '@/lib/templateExtensions';

// Initialize extension hooks before app renders
initTemplateExtensions();


ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
);
