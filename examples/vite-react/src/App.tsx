import { useState, useEffect, useCallback, useRef } from 'react';
import {
  appLogin,
  Storage,
  getPlatformOS,
  getOperationalEnvironment,
  getNetworkStatus,
  getCurrentLocation,
  generateHapticFeedback,
  IAP,
  Analytics,
  graniteEvent,
} from '@apps-in-toss/web-framework';

// --- Styles ---
const colors = {
  bg: '#f4f5f7',
  card: '#ffffff',
  primary: '#3182f6',
  text: '#191f28',
  subtext: '#8b95a1',
  border: '#e5e8eb',
  success: '#00c471',
  tag: '#f2f4f6',
};

const cardStyle: React.CSSProperties = {
  background: colors.card,
  borderRadius: 16,
  padding: 20,
  marginBottom: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};

const buttonStyle: React.CSSProperties = {
  background: colors.primary,
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  padding: '10px 20px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const tagStyle: React.CSSProperties = {
  display: 'inline-block',
  background: colors.tag,
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 13,
  color: colors.text,
  marginRight: 8,
  marginBottom: 4,
};

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 style={{ margin: '0 0 12px', fontSize: 16, color: colors.text }}>{children}</h3>
);

const Result = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
    <span style={{ color: colors.subtext, fontSize: 13 }}>{label}</span>
    <span style={tagStyle}>{value}</span>
  </div>
);

// --- Sections ---

function LoginSection() {
  const [code, setCode] = useState<string | null>(null);

  const handleLogin = async () => {
    const result = await appLogin();
    setCode(result.authorizationCode);
  };

  return (
    <div style={cardStyle}>
      <SectionTitle>Login</SectionTitle>
      <button style={buttonStyle} onClick={handleLogin}>appLogin()</button>
      {code && <Result label="authorizationCode" value={code} />}
    </div>
  );
}

function StorageSection() {
  const [key, setKey] = useState('demo-key');
  const [value, setValue] = useState('hello world');
  const [stored, setStored] = useState<string | null>(null);

  const handleSet = async () => {
    await Storage.setItem(key, value);
    setStored(null);
  };

  const handleGet = async () => {
    const result = await Storage.getItem(key);
    setStored(result);
  };

  return (
    <div style={cardStyle}>
      <SectionTitle>Storage</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input style={inputStyle} placeholder="Key" value={key} onChange={(e) => setKey(e.target.value)} />
        <input style={inputStyle} placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={buttonStyle} onClick={handleSet}>setItem</button>
          <button style={{ ...buttonStyle, background: colors.success }} onClick={handleGet}>getItem</button>
        </div>
        {stored !== null && <Result label="저장된 값" value={stored} />}
      </div>
    </div>
  );
}

function useRefresh(intervalMs = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

function EnvironmentSection() {
  const [network, setNetwork] = useState<string>('');
  useRefresh();
  const platform = getPlatformOS();
  const env = getOperationalEnvironment();

  useEffect(() => {
    const refresh = () => getNetworkStatus().then(setNetwork);
    refresh();
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={cardStyle}>
      <SectionTitle>Environment</SectionTitle>
      <Result label="getPlatformOS()" value={platform} />
      <Result label="getOperationalEnvironment()" value={env} />
      <Result label="getNetworkStatus()" value={network || 'loading...'} />
    </div>
  );
}

function LocationSection() {
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGetLocation = async () => {
    try {
      setError(null);
      const location = await getCurrentLocation();
      setCoords(location.coords);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div style={cardStyle}>
      <SectionTitle>Location</SectionTitle>
      <button style={buttonStyle} onClick={handleGetLocation}>getCurrentLocation()</button>
      {coords && (
        <div style={{ marginTop: 8 }}>
          <Result label="latitude" value={String(coords.latitude)} />
          <Result label="longitude" value={String(coords.longitude)} />
        </div>
      )}
      {error && <p style={{ color: 'red', fontSize: 13, margin: '8px 0 0' }}>{error}</p>}
    </div>
  );
}

function HapticSection() {
  const types = ['tickWeak', 'tap', 'success', 'error', 'confetti'] as const;

  return (
    <div style={cardStyle}>
      <SectionTitle>Haptic Feedback</SectionTitle>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {types.map((type) => (
          <button
            key={type}
            style={{ ...buttonStyle, fontSize: 12, padding: '8px 14px' }}
            onClick={() => generateHapticFeedback({ type })}
          >
            {type}
          </button>
        ))}
      </div>
    </div>
  );
}

function IAPSection() {
  const [products, setProducts] = useState<unknown[]>([]);

  const handleFetch = async () => {
    const result = await IAP.getProductItemList();
    setProducts(result.products);
  };

  return (
    <div style={cardStyle}>
      <SectionTitle>In-App Purchase</SectionTitle>
      <button style={buttonStyle} onClick={handleFetch}>getProductItemList()</button>
      {products.length > 0 && (
        <pre style={{ marginTop: 12, padding: 12, background: colors.tag, borderRadius: 8, fontSize: 12, overflow: 'auto' }}>
          {JSON.stringify(products, null, 2)}
        </pre>
      )}
    </div>
  );
}

function AnalyticsSection() {
  const [clicked, setClicked] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleClick = async () => {
    await Analytics.click({ component: 'demo_button', page: 'main' });
    setClicked(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setClicked(false), 1500);
  };

  return (
    <div style={cardStyle}>
      <SectionTitle>Analytics</SectionTitle>
      <button style={buttonStyle} onClick={handleClick}>
        Analytics.click()
      </button>
      {clicked && (
        <span style={{ ...tagStyle, color: colors.success, marginLeft: 8 }}>Logged!</span>
      )}
    </div>
  );
}

let eventCounter = 0;

function EventSection() {
  const [events, setEvents] = useState<{ id: number; text: string }[]>([]);

  const addEvent = useCallback((name: string) => {
    setEvents((prev) => [{ id: ++eventCounter, text: `[${new Date().toLocaleTimeString()}] ${name}` }, ...prev].slice(0, 10));
  }, []);

  useEffect(() => {
    const unsubBack = graniteEvent.addEventListener('backEvent', {
      onEvent: () => addEvent('backEvent'),
    });
    const unsubHome = graniteEvent.addEventListener('homeEvent', {
      onEvent: () => addEvent('homeEvent'),
    });
    return () => {
      unsubBack();
      unsubHome();
    };
  }, [addEvent]);

  return (
    <div style={cardStyle}>
      <SectionTitle>Granite Events</SectionTitle>
      <p style={{ fontSize: 13, color: colors.subtext, margin: '0 0 8px' }}>
        DevTools 패널에서 backEvent / homeEvent를 트리거해 보세요.
      </p>
      {events.length > 0 ? (
        <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {events.map((e) => (
            <div key={e.id} style={{ padding: '4px 0', borderBottom: `1px solid ${colors.border}` }}>{e.text}</div>
          ))}
        </div>
      ) : (
        <span style={{ fontSize: 13, color: colors.subtext }}>수신된 이벤트 없음</span>
      )}
    </div>
  );
}

// --- App ---

export default function App() {
  return (
    <div style={{ background: colors.bg, minHeight: '100vh', padding: '24px 16px', maxWidth: 480, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.text, margin: '0 0 4px' }}>
        앱인토스 미니앱 데모
      </h1>
      <p style={{ fontSize: 14, color: colors.subtext, margin: '0 0 24px' }}>
        ait-devtools Mock SDK 기능을 테스트합니다.
      </p>

      <LoginSection />
      <StorageSection />
      <EnvironmentSection />
      <LocationSection />
      <HapticSection />
      <IAPSection />
      <AnalyticsSection />
      <EventSection />
    </div>
  );
}
