import { optimizedCloudinaryImage } from './catalog';

export function LoadedImage({ src, alt, className }: { src: string; alt: string; className: string }) {
  return <img
    className={className}
    src={optimizedCloudinaryImage(src)}
    alt={alt}
    decoding="async"
    onError={() => console.error('A storefront image could not be loaded.', src)}
  />;
}
