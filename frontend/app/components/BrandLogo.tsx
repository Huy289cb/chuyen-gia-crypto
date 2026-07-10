import Link from 'next/link';
import { cn } from '@/lib/utils';

interface BrandLogoProps {
  size?: 'sm' | 'md';
  showLink?: boolean;
  className?: string;
}

const boxSizes = {
  sm: 'h-8 w-8',
  md: 'h-9 w-9 sm:h-10 sm:w-10',
};

/** Inline brand mark — bundled with JS, no /public/logo.svg request (avoids Vercel 404). */
function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-hidden
    >
      <defs>
        <linearGradient id="dm-logo-bg" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f59e0b" />
          <stop offset="1" stopColor="#b45309" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#dm-logo-bg)" />
      <path
        d="M38 11 24 35h11l-7 18 22-30H35l3-12z"
        fill="#0a0a0f"
      />
    </svg>
  );
}

export function BrandLogo({ size = 'md', showLink = true, className }: BrandLogoProps) {
  const mark = (
    <LogoMark className={cn(boxSizes[size], 'rounded-xl shrink-0', className)} />
  );

  if (!showLink) {
    return mark;
  }

  return (
    <Link
      href="/"
      aria-label="Download Money — home"
      className="shrink-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary"
    >
      {mark}
    </Link>
  );
}
