// src/components/__tests__/SocialButton.test.tsx
// ponytail: SocialButton is a thin presentational wrapper — only render/Platform gating is testable here.
// The tap → hook wiring is exercised in useSocialLogin.test.ts.
import { render } from '@testing-library/react-native';
import { SocialButton } from '../auth/SocialButton';

describe('SocialButton', () => {
  it('renders the provided label with accessibilityLabel', () => {
    const { getByLabelText } = render(
      <SocialButton provider="apple" label="Sign in with Apple" onPress={() => {}} />,
    );
    expect(getByLabelText('Sign in with Apple')).toBeTruthy();
  });

  it('renders google label with accessibilityLabel', () => {
    const { getByLabelText } = render(
      <SocialButton provider="google" label="Sign in with Google" onPress={() => {}} />,
    );
    expect(getByLabelText('Sign in with Google')).toBeTruthy();
  });
});