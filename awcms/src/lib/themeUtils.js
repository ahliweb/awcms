
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Convert Hex to HSL for Shadcn/Tailwind
export function hexToShadcnHsl(hex) {
  if (!hex) return "hsl(0 0% 100%)"; // Default white

  // Remove # if present
  hex = hex.replace('#', '');

  // Parse r, g, b
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);

  // Convert to HSL
  r /= 255;
  g /= 255;
  b /= 255;

  const cmin = Math.min(r, g, b);
  const cmax = Math.max(r, g, b);
  const delta = cmax - cmin;
  let h;

  if (delta === 0)
    h = 0;
  else if (cmax === r)
    h = ((g - b) / delta) % 6;
  else if (cmax === g)
    h = (b - r) / delta + 2;
  else
    h = (r - g) / delta + 4;

  h = Math.round(h * 60);

  if (h < 0)
    h += 360;

  let l = (cmax + cmin) / 2;

  let s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  s = +(s * 100).toFixed(1);
  l = +(l * 100).toFixed(1);

  // Return standard CSS HSL string for Tailwind v4 compatibility
  // Using modern space-separated syntax inside the function
  return `hsl(${h} ${s}% ${l}%)`;
}

// Convert Shadcn HSL string back to Hex for input[type=color]
export function shadcnHslToHex(hslString) {
  if (!hslString) return "#ffffff";

  // Handle both "H S% L%" (legacy) and "hsl(H S% L%)" (modern)
  let cleanString = hslString;
  if (hslString.startsWith('hsl(')) {
    cleanString = hslString.replace('hsl(', '').replace(')', '');
  }
  // Remove commas if present (legacy syntax support)
  cleanString = cleanString.replace(/,/g, '');

  const parts = cleanString.split(' ').filter(Boolean).map(p => parseFloat(p));
  if (parts.length !== 3) return "#ffffff";

  let h = parts[0];
  let s = parts[1];
  let l = parts[2];

  s /= 100;
  l /= 100;

  let c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = l - c / 2,
    r = 0,
    g = 0,
    b = 0;

  if (0 <= h && h < 60) {
    r = c; g = x; b = 0;
  } else if (60 <= h && h < 120) {
    r = x; g = c; b = 0;
  } else if (120 <= h && h < 180) {
    r = 0; g = c; b = x;
  } else if (180 <= h && h < 240) {
    r = 0; g = x; b = c;
  } else if (240 <= h && h < 300) {
    r = x; g = 0; b = c;
  } else if (300 <= h && h < 360) {
    r = c; g = 0; b = x;
  }

  r = Math.round((r + m) * 255).toString(16);
  g = Math.round((g + m) * 255).toString(16);
  b = Math.round((b + m) * 255).toString(16);

  if (r.length === 1) r = "0" + r;
  if (g.length === 1) g = "0" + g;
  if (b.length === 1) b = "0" + b;

  return "#" + r + g + b;
}

export function applyTheme(config) {
  if (!config) return;

  // We will inject a style tag instead of setting inline styles on root
  // This allows us to define .dark overrides easily.
  let styleTag = document.getElementById('theme-overrides');
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = 'theme-overrides';
    document.head.appendChild(styleTag);
  }

  const generateCssVars = (colors) => {
    if (!colors) return '';
    return Object.entries(colors).map(([key, value]) => {
      const varName = `--${key.replace(/[A-Z]/g, m => "-" + m.toLowerCase())}`;
      let finalValue = value;
      // Handle legacy space-separated format if necessary (though shadcn usually uses hsl() or raw values)
      if (typeof value === 'string' && /^\d+(\.\d+)?\s+\d+(\.\d+)?%?\s+\d+(\.\d+)?%?/.test(value) && !value.startsWith('hsl')) {
        finalValue = `hsl(${value})`;
      }
      return `${varName}: ${finalValue};`;
    }).join('\n');
  };

  const lightVars = generateCssVars(config.colors);
  const darkVars = generateCssVars(config.darkColors);

  let css = `
    :root {
      ${lightVars}
      ${config.radius !== undefined ? `--radius: ${config.radius}rem;` : ''}
      ${config.fonts?.heading ? `--font-heading: ${config.fonts.heading};` : ''}
      ${config.fonts?.body ? `--font-sans: ${config.fonts.body};` : ''}
    }
  `;

  if (darkVars) {
    css += `
      .dark {
        ${darkVars}
      }
    `;
  }

  styleTag.textContent = css;
}
