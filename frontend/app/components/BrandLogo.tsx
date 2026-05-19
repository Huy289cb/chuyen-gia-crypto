import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface BrandLogoProps {
  size?: 'sm' | 'md';
  showLink?: boolean;
  className?: string;
}

const sizes = {
  sm: { box: 'h-8 w-8', img: 32 },
  md: { box: 'h-9 w-9 sm:h-10 sm:w-10', img: 40 },
};

export function BrandLogo({ size = 'md', showLink = true, className }: BrandLogoProps) {
  const { box, img } = sizes[size];

  const image = (
    <Image
      src="/logo.svg"
      alt="Download Money"
      width={img}
      height={img}
      className={cn(box, 'rounded-xl shrink-0', className)}
      priority
    />
  );

  if (!showLink) {
    return image;
  }

  return (
    <Link href="/" className="shrink-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary">
      {image}
    </Link>
  );
}
