import { useEffect, useRef } from 'react';
import twemoji from '@twemoji/api';

/**
 * Hook to render emojis (especially flags) as Twemoji images
 * This ensures consistent emoji rendering across all platforms
 */
export function useTwemoji(elementRef: React.RefObject<HTMLElement>, deps?: React.DependencyList) {
  useEffect(() => {
    if (elementRef.current) {
      twemoji.parse(elementRef.current, {
        folder: 'svg',
        ext: '.svg',
        base: 'https://cdn.jsdelivr.net/npm/@twemoji/api@latest/assets/',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ? [...deps] : [elementRef.current]);
}

/**
 * Component that renders text with Twemoji emojis
 */
export function TwemojiText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (ref.current) {
      twemoji.parse(ref.current, {
        folder: 'svg',
        ext: '.svg',
        base: 'https://cdn.jsdelivr.net/npm/@twemoji/api@latest/assets/',
      });
    }
  }, [text]);

  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
}
