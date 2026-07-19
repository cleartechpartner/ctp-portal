import { useState, useEffect } from 'react';

// International phone input: country picker (flag + dial code) plus the
// local number. Defaults to Spain +34. Emits a single display string like
// "+34 971 361 400" through onChange, or '' when the number is empty.

const COUNTRIES = [
  ['ES', 'Spain', '34'],
  ['AD', 'Andorra', '376'],
  ['AR', 'Argentina', '54'],
  ['AT', 'Austria', '43'],
  ['AU', 'Australia', '61'],
  ['BE', 'Belgium', '32'],
  ['BR', 'Brazil', '55'],
  ['CA', 'Canada', '1'],
  ['CH', 'Switzerland', '41'],
  ['CL', 'Chile', '56'],
  ['CN', 'China', '86'],
  ['CO', 'Colombia', '57'],
  ['CZ', 'Czechia', '420'],
  ['DE', 'Germany', '49'],
  ['DK', 'Denmark', '45'],
  ['EE', 'Estonia', '372'],
  ['FI', 'Finland', '358'],
  ['FR', 'France', '33'],
  ['GB', 'United Kingdom', '44'],
  ['GR', 'Greece', '30'],
  ['HR', 'Croatia', '385'],
  ['HU', 'Hungary', '36'],
  ['IE', 'Ireland', '353'],
  ['IL', 'Israel', '972'],
  ['IN', 'India', '91'],
  ['IS', 'Iceland', '354'],
  ['IT', 'Italy', '39'],
  ['JP', 'Japan', '81'],
  ['KR', 'South Korea', '82'],
  ['LT', 'Lithuania', '370'],
  ['LU', 'Luxembourg', '352'],
  ['LV', 'Latvia', '371'],
  ['MA', 'Morocco', '212'],
  ['MC', 'Monaco', '377'],
  ['MT', 'Malta', '356'],
  ['MX', 'Mexico', '52'],
  ['NL', 'Netherlands', '31'],
  ['NO', 'Norway', '47'],
  ['NZ', 'New Zealand', '64'],
  ['PL', 'Poland', '48'],
  ['PT', 'Portugal', '351'],
  ['RO', 'Romania', '40'],
  ['SE', 'Sweden', '46'],
  ['SG', 'Singapore', '65'],
  ['SI', 'Slovenia', '386'],
  ['SK', 'Slovakia', '421'],
  ['TR', 'Turkey', '90'],
  ['US', 'United States', '1'],
  ['UY', 'Uruguay', '598'],
  ['ZA', 'South Africa', '27'],
];

const flagOf = (iso) => String.fromCodePoint(...[...iso].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));

// Split a stored value like "+34 971 361 400" into country + local part.
// Longest dial-code match wins; anything unmatched defaults to Spain.
function parseValue(value) {
  const s = String(value || '').trim();
  if (!s.startsWith('+')) return { iso: 'ES', local: s };
  const digits = s.slice(1);
  let best = null;
  for (const [iso, , dial] of COUNTRIES) {
    if (digits.startsWith(dial) && (!best || dial.length > best.dial.length)) best = { iso, dial };
  }
  if (!best) return { iso: 'ES', local: s };
  return { iso: best.iso, local: digits.slice(best.dial.length).trim() };
}

export default function PhoneInput({ value, onChange, autoFocus }) {
  const [{ iso, local }, setState] = useState(() => parseValue(value));
  useEffect(() => { setState(parseValue(value)); }, [value]);

  const dialOf = (i) => (COUNTRIES.find(c => c[0] === i) || COUNTRIES[0])[2];

  const emit = (nextIso, nextLocal) => {
    setState({ iso: nextIso, local: nextLocal });
    const cleaned = nextLocal.trim();
    onChange(cleaned ? `+${dialOf(nextIso)} ${cleaned}` : '');
  };

  return (
    <div className="phone-in">
      <select
        className="phone-in-cc"
        value={iso}
        onChange={e => emit(e.target.value, local)}
        aria-label="Country code"
      >
        {COUNTRIES.map(([i, name, dial]) => (
          <option key={i} value={i}>{flagOf(i)} +{dial} {name}</option>
        ))}
      </select>
      <input
        className="ti phone-in-num"
        type="tel"
        value={local}
        onChange={e => emit(iso, e.target.value)}
        placeholder="971 361 400"
        autoFocus={autoFocus}
        aria-label="Phone number"
      />
    </div>
  );
}
