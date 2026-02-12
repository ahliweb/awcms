
import React from 'react';
import { Helmet } from 'react-helmet-async';

// Component to handle secure headers and SEO metadata for public pages
function SeoHelmet({ 
    title, 
    description, 
    keywords, 
    image, 
    url, 
    type = 'website' 
}) {
  const siteTitle = 'AWCMS';
  const fullTitle = title ? `${title} | ${siteTitle}` : siteTitle;
  const metaDescription = description || 'A secure, extensible content management system.';
  
  return (
    <Helmet>
      {/* Basic Metadata */}
      <title>{fullTitle}</title>
      <meta name="description" content={metaDescription} />
      {keywords && <meta name="keywords" content={keywords} />}
      
      {/* Open Graph / Facebook */}
      <meta property="og:type" content={type} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={metaDescription} />
      {image && <meta property="og:image" content={image} />}
      {url && <meta property="og:url" content={url} />}
      
      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={metaDescription} />
      {image && <meta name="twitter:image" content={image} />}

      {/* Security Headers (Simulated via Meta tags where possible, real enforcement needs Server/Edge config) */}
      <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
      <meta httpEquiv="X-Frame-Options" content="SAMEORIGIN" />
      <meta httpEquiv="X-XSS-Protection" content="1; mode=block" />
      <meta httpEquiv="Referrer-Policy" content="strict-origin-when-cross-origin" />
      
      {/* Content Security Policy - Basic strict policy */}
      {/* Note: This is a strict policy, might need adjustment for external images/scripts */}
      {/* <meta http-equiv="Content-Security-Policy" content="default-src 'self' https://*.supabase.co; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline';" /> */}
    </Helmet>
  );
}

export default SeoHelmet;
