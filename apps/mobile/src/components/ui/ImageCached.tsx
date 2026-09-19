// src/components/ui/ImageCached.tsx
// Memoized expo-image wrapper. Centralizes cache policy, transition, and
// placeholder so every cached image in the app behaves the same.
import { Image, type ImageProps } from 'expo-image';
import { memo } from 'react';

const PLACEHOLDER = require('../../../assets/images/icon.png');

export type ImageCachedProps = Omit<ImageProps, 'source'> & { source: NonNullable<ImageProps['source']> };

function ImageCachedBase(props: ImageCachedProps) {
  return (
    <Image
      cachePolicy="memory-disk"
      contentFit="cover"
      transition={200}
      placeholder={PLACEHOLDER}
      {...props}
    />
  );
}

export const ImageCached = memo(ImageCachedBase);