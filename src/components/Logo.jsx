// Family Dental Health apple mark — bitten red apple with a green leaf, drawn
// as inline SVG so it stays crisp on the teal sidebar, light top bar, and
// sign-in screen (and needs no external asset / network / paid service).
// To use the official artwork instead, drop it at public/logo.png and swap
// this component's body for <img src="/logo.png" ... />.
export default function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Family Dental Health">
      {/* leaf + stem */}
      <path d="M25.2 12.4c1-4.4 4.6-7.2 8.8-7-.5 4.5-4.2 7.6-8.8 7z" fill="#6fbf3b" />
      <path d="M25.6 11.6c1.4-2.1 3.4-3.6 6-4.4" stroke="#4f9e34" strokeWidth="1" fill="none" opacity=".6" />
      <path d="M23.9 12.8c-.3-2.3.4-4.3 1.8-5.7" stroke="#7a3b1e" strokeWidth="2" strokeLinecap="round" fill="none" />
      {/* apple body with a bite out of the right side */}
      <path d="M23.6 14.4c-3.2-4.6-9.4-4.8-13.2-1.4-4.2 3.8-4 11.4.2 18.2 2.6 4.2 6 6.9 8.8 6.9 1.8 0 2.8-.9 4.6-.9s2.8.9 4.6.9c2.8 0 6.2-2.7 8.8-6.9.8-1.3 1.4-2.6 1.8-3.9-1 .5-2.2.8-3.5.8-4.3 0-7.2-2.6-7.2-6.5 0-2.8 1.5-5.1 3.9-6.2-2.8-1.6-6.5-1.4-9.4 1-.3.3-.6.3-.9-.6z" fill="#d63a2c" />
      {/* shading + highlight for a little depth */}
      <path d="M12.4 29.5c1.9 4.2 5 7.5 7.7 7.7-3.6-.2-6.8-3.2-8.8-7.7.4 0 .8 0 1.1 0z" fill="#b0281d" opacity=".55" />
      <ellipse cx="15.5" cy="19.5" rx="2.3" ry="3.4" fill="#fff" opacity=".32" transform="rotate(-20 15.5 19.5)" />
    </svg>
  );
}
