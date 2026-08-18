// Default Nexus Field mark — used whenever a workspace hasn't set its own
// logoUrl (branding is per-tenant; see Settings.jsx's Branding section and
// Layout.jsx applying org.branding.primaryColor as --primary). Uses the CSS
// theme variables rather than literal hex, so this default mark automatically
// picks up a workspace's brand color even before they've uploaded a logo.
export default function Logo({ size = 28, logoUrl = null }) {
  if (logoUrl) {
    return <img src={logoUrl} width={size} height={size} alt="" style={{ borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Nexus Field">
      <defs>
        <linearGradient id="nf-mark-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--primary)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--brand-green, var(--primary))' }} />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#nf-mark-grad)" />
      <path d="M14 33V15h4.6l10.8 13.9V15H34v18h-4.6L18.6 19.1V33H14z" fill="#fff" />
    </svg>
  );
}
