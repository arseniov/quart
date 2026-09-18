// src/a11y/Announcer.tsx
import { useEffect } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { _setAnnouncer } from './announcer';

export function Announcer() {
  useEffect(() => {
    _setAnnouncer((msg) => {
      if (msg) AccessibilityInfo.announceForAccessibility(msg);
    });
    return () => _setAnnouncer(() => undefined);
  }, []);
  return <View accessibilityLiveRegion="polite" importantForAccessibility="no" />;
}
