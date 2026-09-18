// src/a11y/Announcer.tsx
import { useEffect, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { _setAnnouncer } from './announcer';

export function Announcer() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    _setAnnouncer((msg) => {
      setMessage('');
      // Force re-render so SR re-reads identical strings.
      requestAnimationFrame(() => setMessage(msg));
      if (msg) AccessibilityInfo.announceForAccessibility(msg);
    });
    return () => _setAnnouncer(() => undefined);
  }, []);
  return <View accessibilityLiveRegion="polite" accessibilityElementsHidden importantForAccessibility="no" />;
}