// Family Dental Health apple mark (inline SVG so it stays crisp on the teal
// sidebar, light top bar, and sign-in screen). To use the official artwork
// instead, drop it at public/logo.png and swap this for <img src="/logo.png">.
export default function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-label="Family Dental Health" role="img">
      {/* leaf */}
      <path d="M25.5 12.5c1.2-4.2 4.8-6.8 8.8-6.8-.6 4.4-4.2 7.6-8.8 6.8z" fill="#7cbf3f" />
      {/* stem */}
      <path d="M24 13c-.2-2.4.6-4.4 2-5.8" stroke="#7a3b1e" strokeWidth="2" strokeLinecap="round" />
      {/* apple body */}
      <path d="M23.6 14.4c-3.2-4.6-9.4-4.8-13.2-1.4-4.2 3.8-4 11.4.2 18.2 2.6 4.2 6 6.9 8.8 6.9 1.8 0 2.8-.9 4.6-.9s2.8.9 4.6.9c2.8 0 6.2-2.7 8.8-6.9 2.6-4.2 3.4-9.2.8-13-2.8-4-8.8-4.6-12.6-1.2-.3.3-.6.3-.9-.6z" fill="#e23b2e" />
      {/* highlight */}
      <ellipse cx="16.5" cy="20" rx="2.4" ry="3.4" fill="#fff" opacity="0.28" transform="rotate(-20 16.5 20)" />
    </svg>
  );
}
