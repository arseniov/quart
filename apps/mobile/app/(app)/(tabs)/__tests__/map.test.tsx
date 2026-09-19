// app/(app)/(tabs)/__tests__/map.test.tsx
import { render } from '@testing-library/react-native';
import i18n from '@/i18n';

jest.mock('@/api/hooks/useMe');
jest.mock('@/api/hooks/useMapMarkers');

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('@/components/issue/IssueMap', () => ({
  IssueMap: () => {
    const { View } = require('react-native');
    return <View testID="issue-map" />;
  },
}));

jest.mock('@/components/issue/MapEmptyState', () => ({
  MapEmptyState: () => {
    const { View } = require('react-native');
    return <View testID="map-empty-state" />;
  },
}));

import { useMe } from '@/api/hooks/useMe';
import { useMapMarkers } from '@/api/hooks/useMapMarkers';
import MapScreen from '../map';

const getReplaceMock = () =>
  jest.requireMock('expo-router').router.replace as jest.Mock;

describe('MapScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  afterAll(async () => {
    await i18n.changeLanguage('it');
  });

  beforeEach(() => {
    getReplaceMock().mockClear();
    (useMe as jest.Mock).mockReset();
    (useMapMarkers as jest.Mock).mockReset();
  });

  const makeMe = (overrides: Partial<{ needs_onboarding: boolean; city_id: string | null }> = {}) => ({
    id: 'u1',
    handle: 'u1',
    display_name: 'U',
    email: null,
    phone_e164: null,
    avatar_url: null,
    preferred_locale: 'en',
    roles: [],
    needs_onboarding: false,
    city_id: 'c1',
    ...overrides,
  });

  it('redirects to onboarding when needs_onboarding is true', () => {
    (useMe as jest.Mock).mockReturnValue({
      data: makeMe({ needs_onboarding: true, city_id: null }),
      isPending: false,
    });
    (useMapMarkers as jest.Mock).mockReturnValue({ data: undefined, isPending: false, isError: false, refetch: jest.fn() });
    const { toJSON } = render(<MapScreen />);
    expect(toJSON()).toBeNull();
    expect(getReplaceMock()).toHaveBeenCalledWith('/onboarding/city');
  });

  it('redirects to onboarding when city_id is null', () => {
    (useMe as jest.Mock).mockReturnValue({
      data: makeMe({ needs_onboarding: false, city_id: null }),
      isPending: false,
    });
    (useMapMarkers as jest.Mock).mockReturnValue({ data: undefined, isPending: false, isError: false, refetch: jest.fn() });
    render(<MapScreen />);
    expect(getReplaceMock()).toHaveBeenCalledWith('/onboarding/city');
  });

  it('does NOT redirect when user is null (parent layout owns auth)', () => {
    (useMe as jest.Mock).mockReturnValue({ data: null, isPending: true });
    (useMapMarkers as jest.Mock).mockReturnValue({ data: undefined, isPending: false, isError: false, refetch: jest.fn() });
    render(<MapScreen />);
    expect(getReplaceMock()).not.toHaveBeenCalled();
  });

  it('renders MapEmptyState when markers list is empty', () => {
    (useMe as jest.Mock).mockReturnValue({ data: makeMe(), isPending: false });
    (useMapMarkers as jest.Mock).mockReturnValue({ data: [], isPending: false, isError: false, refetch: jest.fn() });
    const { getByTestId, queryByTestId } = render(<MapScreen />);
    expect(getByTestId('map-empty-state')).toBeTruthy();
    expect(queryByTestId('issue-map')).toBeNull();
    expect(getReplaceMock()).not.toHaveBeenCalled();
  });

  it('renders IssueMap when markers exist', () => {
    (useMe as jest.Mock).mockReturnValue({ data: makeMe(), isPending: false });
    (useMapMarkers as jest.Mock).mockReturnValue({
      data: [{ id: 'i1', kind: 'issue', lat: 0, lng: 0, title: 'x' }],
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    });
    const { getByTestId, queryByTestId } = render(<MapScreen />);
    expect(getByTestId('issue-map')).toBeTruthy();
    expect(queryByTestId('map-empty-state')).toBeNull();
  });
});