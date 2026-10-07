// Configuración compartida de Tailwind (paleta y tipografía Premier Can)
//
// Los colores son VARIABLES CSS: cada token tiene un valor claro y uno oscuro
// (verde con negro). El modo oscuro se activa con la clase "pc-oscuro" en
// <html> (la pone cargando.js antes del primer dibujo). No se usa la clase
// "dark" de Tailwind a propósito: las páginas traen muchas variantes "dark:"
// sobrantes de la plantilla original que mezclarían colores.
(function () {
  const CLARO = {
    "inverse-on-surface": "#dff4ff",
    "surface-tint": "#006874",
    "tertiary-fixed": "#d2e6ef",
    "on-background": "#0d2226",
    "on-primary-container": "#d7f9ff",
    "on-tertiary-fixed": "#0b1e24",
    "on-secondary-fixed-variant": "#005313",
    "primary": "#00606a",
    "surface-container-highest": "#d3e3e5",
    "on-surface-variant": "#4a5b5e",
    "surface-variant": "#d3e3e5",
    "surface-container-low": "#eef5f6",
    "on-secondary-container": "#0c7521",
    "on-error": "#ffffff",
    "inverse-surface": "#1e333c",
    "primary-container": "#0d7a87",
    "inverse-primary": "#7dd4e2",
    "secondary-fixed-dim": "#7ddc7a",
    "error-container": "#ffdad6",
    "on-primary": "#ffffff",
    "primary-fixed": "#99f0fe",
    "on-secondary-fixed": "#002204",
    "on-primary-fixed": "#001f24",
    "secondary-container": "#98f994",
    "on-error-container": "#93000a",
    "primary-fixed-dim": "#7dd4e2",
    "surface-container-lowest": "#ffffff",
    "surface-container-high": "#dde9eb",
    "on-tertiary-container": "#e3f6ff",
    "surface-container": "#e6f0f1",
    "surface-dim": "#c7dde9",
    "background": "#f4f8f9",
    "error": "#ba1a1a",
    "tertiary": "#475961",
    "tertiary-container": "#5f727a",
    "surface-bright": "#f8fbfb",
    "on-primary-fixed-variant": "#004f58",
    "secondary-fixed": "#98f994",
    "on-secondary": "#ffffff",
    "outline-variant": "#d9e4e6",
    "on-tertiary-fixed-variant": "#374951",
    "secondary": "#006e1c",
    "tertiary-fixed-dim": "#b6cad2",
    "surface": "#f4f8f9",
    "outline": "#6e797b",
    "on-surface": "#0d2226",
    "on-tertiary": "#ffffff"
  };

  // Modo oscuro: negro verdoso de fondo, acentos verde esmeralda / menta
  const OSCURO = {
    "inverse-on-surface": "#0f1a18",
    "surface-tint": "#3ddc97",
    "tertiary-fixed": "#cfe3dd",
    "on-background": "#e2f1ec",
    "on-primary-container": "#a7f3d0",
    "on-tertiary-fixed": "#0b1e24",
    "on-secondary-fixed-variant": "#14532d",
    "primary": "#3ddc97",
    "surface-container-highest": "#243b35",
    "on-surface-variant": "#9db8b1",
    "surface-variant": "#243b35",
    "surface-container-low": "#14231f",
    "on-secondary-container": "#86efac",
    "on-error": "#3d0a07",
    "inverse-surface": "#dcefe9",
    "primary-container": "#0f3d30",
    "inverse-primary": "#00694a",
    "secondary-fixed-dim": "#86efac",
    "error-container": "#3d1614",
    "on-primary": "#00281a",
    "primary-fixed": "#a7f3d0",
    "on-secondary-fixed": "#002109",
    "on-primary-fixed": "#002116",
    "secondary-container": "#12351f",
    "on-error-container": "#ffb4ab",
    "primary-fixed-dim": "#6ee7b7",
    "surface-container-lowest": "#111d1a",
    "surface-container-high": "#1d322d",
    "on-tertiary-container": "#cfe3dd",
    "surface-container": "#182a26",
    "surface-dim": "#0a1311",
    "background": "#0a1311",
    "error": "#ff7b72",
    "tertiary": "#9fb7b0",
    "tertiary-container": "#22342f",
    "surface-bright": "#152420",
    "on-primary-fixed-variant": "#005239",
    "secondary-fixed": "#bbf7d0",
    "on-secondary": "#002109",
    "outline-variant": "#24382f",
    "on-tertiary-fixed-variant": "#374951",
    "secondary": "#4ade80",
    "tertiary-fixed-dim": "#b6cad2",
    "surface": "#0a1311",
    "outline": "#6f8a83",
    "on-surface": "#e2f1ec",
    "on-tertiary": "#0f1a18"
  };

  const rgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
  };
  const vars = (paleta) => Object.entries(paleta).map(([k, v]) => `--tw-c-${k}:${rgb(v)};`).join('');

  const estilo = document.createElement('style');
  estilo.id = 'pc-paleta';
  estilo.textContent = `:root{${vars(CLARO)}}html.pc-oscuro{${vars(OSCURO)}color-scheme:dark;}`;
  document.head.appendChild(estilo);

  const colors = {};
  Object.keys(CLARO).forEach((k) => { colors[k] = `rgb(var(--tw-c-${k}) / <alpha-value>)`; });

  tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    "colors": colors,
                    "borderRadius": {
                        "DEFAULT": "0.75rem",
                        "md": "0.625rem",
                        "lg": "1.25rem",
                        "xl": "1.5rem",
                        "2xl": "1.75rem",
                        "full": "9999px"
                    },
                    "boxShadow": {
                        "sm": "0 1px 2px rgba(13, 34, 38, .05), 0 1px 3px rgba(13, 34, 38, .04)",
                        "DEFAULT": "0 2px 6px rgba(13, 34, 38, .05), 0 8px 24px -12px rgba(0, 96, 106, .18)",
                        "md": "0 4px 10px rgba(13, 34, 38, .05), 0 14px 32px -14px rgba(0, 96, 106, .22)",
                        "lg": "0 8px 18px rgba(13, 34, 38, .06), 0 24px 48px -20px rgba(0, 96, 106, .28)",
                        "xl": "0 12px 28px rgba(13, 34, 38, .08), 0 32px 64px -24px rgba(0, 96, 106, .32)",
                        "2xl": "0 24px 80px -12px rgba(0, 50, 56, .35)"
                    },
                    "spacing": {
                        "base": "8px",
                        "gutter": "24px",
                        "xs": "4px",
                        "sm": "12px",
                        "lg": "48px",
                        "xl": "64px",
                        "md": "24px",
                        "margin-mobile": "16px",
                        "margin-desktop": "40px"
                    },
                    "fontFamily": {
                        "headline-lg": ["Manrope"],
                        "body-lg": ["Hanken Grotesk"],
                        "label-md": ["Hanken Grotesk"],
                        "caption": ["Hanken Grotesk"],
                        "body-md": ["Hanken Grotesk"],
                        "headline-lg-mobile": ["Manrope"],
                        "headline-md": ["Manrope"],
                        "display-lg": ["Manrope"]
                    },
                    "fontSize": {
                        "headline-lg": ["32px", { "lineHeight": "40px", "fontWeight": "600" }],
                        "body-lg": ["18px", { "lineHeight": "28px", "fontWeight": "400" }],
                        "label-md": ["14px", { "lineHeight": "20px", "letterSpacing": "0.05em", "fontWeight": "600" }],
                        "caption": ["12px", { "lineHeight": "16px", "fontWeight": "400" }],
                        "body-md": ["16px", { "lineHeight": "24px", "fontWeight": "400" }],
                        "headline-lg-mobile": ["24px", { "lineHeight": "32px", "fontWeight": "600" }],
                        "headline-md": ["24px", { "lineHeight": "32px", "fontWeight": "600" }],
                        "display-lg": ["48px", { "lineHeight": "56px", "letterSpacing": "-0.02em", "fontWeight": "700" }]
                    }
                }
            }
        };
})();
