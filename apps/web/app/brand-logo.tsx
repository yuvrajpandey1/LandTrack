/* eslint-disable @next/next/no-img-element -- static brand artwork; plain <img> avoids runtime image optimisation */

const LOGOS = {
  horizontal: { src: '/brand/landtrack-logo-horizontal.png', width: 628, height: 160 },
  stacked: { src: '/brand/landtrack-logo.png', width: 640, height: 502 },
  mark: { src: '/brand/landtrack-mark.png', width: 306, height: 256 }
} as const;

type BrandLogoProps = {
  /** horizontal: mark + wordmark (headers); stacked: full logo with tagline; mark: icon only. */
  variant?: keyof typeof LOGOS;
  /** Rendered height in CSS pixels; width follows the artwork's aspect ratio. */
  height?: number;
  /** Place the logo on a white badge so the navy/green artwork stays legible on dark backgrounds. */
  onDark?: boolean;
  className?: string;
};

export function BrandLogo({ variant = 'horizontal', height = 34, onDark = false, className }: BrandLogoProps) {
  const logo = LOGOS[variant];
  const image = (
    <img
      src={logo.src}
      alt="LandTrack"
      width={Math.round((logo.width * height) / logo.height)}
      height={height}
      className="brand-logo-img"
      decoding="async"
    />
  );
  const classes = ['brand-logo', onDark ? 'brand-logo-badge' : '', className ?? ''].filter(Boolean).join(' ');
  return <span className={classes}>{image}</span>;
}
