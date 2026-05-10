/**
 * Static OG image template (1200x630) for the @ait-co/devtools npm landing.
 *
 * Mirrors the homepage OG design (apps-in-toss-community.github.io's
 * src/og/template.tsx) for brand consistency. devtools ships a single OG image,
 * so the props are flattened to constants by build-og-image.tsx at build time.
 *
 * satori only supports a subset of CSS — flex layout, no grid. Keep
 * positioning explicit (every node with multiple children has display: 'flex').
 */

interface OgTemplateProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  footer: string;
}

const COLORS = {
  bg: '#f4f5f7',
  brand: '#3182f6',
  fg: '#191f28',
  fgSoft: '#4e5968',
  fgMuted: '#8b95a1',
  white: '#ffffff',
};

export function OgTemplate({ eyebrow, title, subtitle, footer }: OgTemplateProps) {
  return (
    <div
      style={{
        width: 1200,
        height: 630,
        display: 'flex',
        flexDirection: 'row',
        background: COLORS.bg,
        padding: '96px',
        alignItems: 'center',
        gap: '44px',
        fontFamily: 'Pretendard',
      }}
    >
      <div
        style={{
          width: 280,
          height: 280,
          borderRadius: 56,
          background: COLORS.brand,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            color: COLORS.white,
            fontSize: 110,
            fontWeight: 800,
            letterSpacing: '-3px',
          }}
        >
          AITC
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minWidth: 0,
        }}
      >
        <div
          style={{
            color: COLORS.brand,
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: '2px',
            textTransform: 'uppercase',
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            color: COLORS.fg,
            fontSize: 52,
            fontWeight: 800,
            letterSpacing: '-2px',
            marginTop: 18,
            lineHeight: 1.1,
          }}
        >
          {title}
        </div>
        <div
          style={{
            color: COLORS.fgSoft,
            fontSize: 32,
            fontWeight: 500,
            letterSpacing: '-0.5px',
            marginTop: 22,
            lineHeight: 1.35,
          }}
        >
          {subtitle}
        </div>
        <div
          style={{
            color: COLORS.fgMuted,
            fontSize: 24,
            fontWeight: 500,
            marginTop: 28,
          }}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}
