// The B-Trust mark: a rounded shield with a "B" and a growing leaf, drawn in SVG so it is sharp at every size.
// Used on the start page and in the online banking header.
export default function BrandMark({ size = 36, title = 'B-Trust' }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={title}>
      <path d="M20 2 35 7v12c0 9.5-6.4 16.4-15 19C11.4 35.4 5 28.5 5 19V7z" fill="var(--pine-700)" />
      <path d="M20 5.2 32 9.3V19c0 7.8-5 13.6-12 16-7-2.4-12-8.2-12-16V9.3z" fill="none" stroke="var(--brand-gold)" strokeWidth="1.2" />
      <text x="20" y="25.5" textAnchor="middle" fontFamily="var(--font-sans)" fontWeight="700" fontSize="16" fill="#fff">
        B
      </text>
      <path d="M26.5 12.5c-3.6.2-5.6 2.3-5.4 5.6 3.3.1 5.4-2 5.4-5.6z" fill="var(--brand-gold)" />
    </svg>
  );
}
