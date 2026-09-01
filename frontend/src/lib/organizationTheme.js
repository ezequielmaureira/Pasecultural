// Organization Theme — Premium Light Theme fijo. Antes esta clase activaba
// tokens CSS computados desde brandPrimaryColor/brandSecondaryColor (ver
// buildOrganizationTheme, eliminado); esa dirección de producto quedó
// cancelada. Ahora ORG_THEME_CLASS sólo activa un light theme FIJO de
// PaseCultural (tokens definidos en styles/index.css, bloque `.org-theme`)
// — ningún color se deriva ni se calcula por organización.
export const ORG_THEME_CLASS = "org-theme";
