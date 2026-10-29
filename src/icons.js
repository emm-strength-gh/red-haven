// Cartoon SVG icon set. Every shape gets a thick ink outline from CSS (.ico *);
// `ns` drops the outline, `hl` draws a white highlight stroke.

const sun = `<g fill="#ff9f1c">${[0, 45, 90, 135, 180, 225, 270, 315].map(a => {
  const r = a * Math.PI / 180;
  return `<circle cx="${(24 + Math.cos(r) * 17).toFixed(1)}" cy="${(24 + Math.sin(r) * 17).toFixed(1)}" r="3.4"/>`;
}).join('')}</g><circle cx="24" cy="24" r="10" fill="#ffd23f"/><path class="hl" d="M19 21 q2 -4 6 -4"/>`;

const cloud = (fill) => `<path d="M13 31 a8 8 0 0 1 1.5 -15.8 A11 11 0 0 1 35.5 14.5 a8.3 8.3 0 0 1 0.5 16.5 Z" fill="${fill}"/><path class="hl" d="M15 24 q0 -4 4 -5"/>`;

const ICONS = {
  timber: `<rect x="5" y="23" width="32" height="14" rx="7" fill="#d4874a"/><ellipse cx="37" cy="30" rx="5.5" ry="7" fill="#f6c98a"/><ellipse class="ns" cx="37" cy="30" rx="2" ry="3" fill="#d4874a"/><rect x="11" y="9" width="28" height="13" rx="6.5" fill="#e59b5a"/><ellipse cx="39" cy="15.5" rx="5" ry="6.5" fill="#f6c98a"/><ellipse class="ns" cx="39" cy="15.5" rx="1.8" ry="2.6" fill="#d4874a"/>`,
  metal: `<path d="M5 37 L12 23 H36 L43 37 Z" fill="#8fa6b8"/><path d="M12 23 L17 12 H31 L36 23 Z" fill="#dfe9ef"/><path class="hl" d="M20 16 H26"/>`,
  food: `<circle cx="24" cy="28" r="15" fill="#ff5f57"/><path d="M24 15 V8" fill="none"/><path d="M14 17 Q19 21 24 15 Q29 21 34 17 Q31 23 24 21 Q17 23 14 17 Z" fill="#6cc04a"/><path class="hl" d="M14 27 q1 -5 5 -7"/>`,
  power: `<path d="M28 3 L9 27 H22 L18 45 L39 19 H26 Z" fill="#ffd23f"/><path class="hl" d="M25 9 L17 21"/>`,
  sun,
  menu: `<rect x="8" y="10" width="32" height="7" rx="3.5" fill="#fff6e4"/><rect x="8" y="21" width="32" height="7" rx="3.5" fill="#fff6e4"/><rect x="8" y="32" width="32" height="7" rx="3.5" fill="#fff6e4"/>`,
  planet: `<circle cx="24" cy="24" r="15" fill="#ff8a3d"/><circle class="ns" cx="18" cy="20" r="3.5" fill="#e0662a"/><circle class="ns" cx="29" cy="29" r="2.5" fill="#e0662a"/><circle class="ns" cx="27" cy="17" r="1.6" fill="#e0662a"/><path d="M4 31 Q24 19 44 17" fill="none" style="stroke-width:5"/><path class="ns" d="M4 31 Q24 19 44 17" fill="none" style="stroke:#ffd23f;stroke-width:2;stroke-linecap:round"/><path class="hl" d="M14 15 q4 -4 9 -4"/>`,
  shelter: `<path d="M3 39 H45" fill="none"/><path d="M8 39 Q8 13 24 11 Q40 13 40 39 Z" fill="#fff1d6"/><path d="M9.5 25 Q24 20 38.5 25 L39.5 31 Q24 26 8.5 31 Z" fill="#ff5f57"/><path d="M19 39 V34 a5 5 0 0 1 10 0 V39 Z" fill="#8a5a36"/><path d="M31 12 L34 5" fill="none"/><circle cx="34" cy="5" r="2.4" fill="#ff5f57"/>`,
  farm: `<path d="M6 33 H42 L38 43 H10 Z" fill="#a0612f"/><path d="M24 33 V19" fill="none"/><path d="M24 26 Q13 26 11 16 Q22 15 24 26 Z" fill="#8ee04e"/><path d="M24 21 Q31 11 38 13 Q37 23 24 22 Z" fill="#6cc04a"/><circle cx="35" cy="29" r="3.5" fill="#ff5f57"/>`,
  solar: `<path d="M24 30 V42 M15 42 H33" fill="none"/><path d="M5 31 L13 11 H43 L35 31 Z" fill="#4d96ff"/><path d="M9 21 H39 M23.5 11 L19.5 31" fill="none" style="stroke:#bfe3ff;stroke-width:2"/><path class="hl" d="M16 14 L14 18"/>`,
  wall: `<path d="M5 14 V8 H12 V14 H18 V8 H24 V14 H30 V8 H36 V14 H43 V40 H5 Z" fill="#e0895a"/><path d="M5 22 H43 M5 31 H43 M17 14 V22 M31 14 V22 M11 22 V31 M24 22 V31 M37 22 V31 M17 31 V40 M31 31 V40" fill="none" style="stroke-width:2"/>`,
  turret: `<path d="M9 43 L13 31 H35 L39 43 Z" fill="#8a96a3"/><rect x="29" y="18" width="16" height="7" rx="3.5" fill="#4a5568"/><rect x="12" y="14" width="22" height="17" rx="7" fill="#fff1d6"/><circle cx="20" cy="22.5" r="3.4" fill="#5ed3f3"/><path d="M12 25 H34" fill="none" style="stroke:#ff5f57;stroke-width:3"/>`,
  beacon: `<path d="M15 43 L24 15 L33 43 M18.5 33 H29.5" fill="none"/><path d="M11 43 H37" fill="none"/><circle cx="24" cy="13" r="5.5" fill="#ffd23f"/><path d="M14 6 Q10 13 14 20 M34 6 Q38 13 34 20" fill="none" style="stroke:#2ec4b6;stroke-width:3"/><path d="M8 3 Q2 13 8 23 M40 3 Q46 13 40 23" fill="none" style="stroke:#2ec4b6;stroke-width:3"/>`,
  inspect: `<rect x="27" y="31" width="17" height="7.5" rx="3.75" transform="rotate(45 35.5 34.75)" fill="#ff8a3d"/><circle cx="20" cy="20" r="12" fill="#bdf0ff"/><path class="hl" d="M13 18 q2 -6 8 -6"/>`,
  gather: `<rect x="21" y="10" width="6.5" height="34" rx="3.25" transform="rotate(30 24 27)" fill="#b06a35"/><path d="M5 18 Q22 1 42 14 Q25 8 5 18 Z" fill="#c7d2da"/>`,
  play: `<path d="M15 9 L39 24 L15 39 Z" fill="#8ee04e"/>`,
  pause: `<rect x="11" y="9" width="10" height="30" rx="4" fill="#fff6e4"/><rect x="27" y="9" width="10" height="30" rx="4" fill="#fff6e4"/>`,
  fast: `<path d="M5 11 L23 24 L5 37 Z" fill="#ffd23f"/><path d="M24 11 L42 24 L24 37 Z" fill="#ffd23f"/>`,
  plus: `<path d="M20 7 H28 V20 H41 V28 H28 V41 H20 V28 H7 V20 H20 Z" fill="#fff6e4"/>`,
  minus: `<rect x="7" y="20" width="34" height="8" rx="3" fill="#fff6e4"/>`,
  close: `<path d="M20 7 H28 V20 H41 V28 H28 V41 H20 V28 H7 V20 H20 Z" transform="rotate(45 24 24)" fill="#fff6e4"/>`,
  rain: `${cloud('#e8f4ff')}<path d="M17 36 l-2.5 6 M25 36 l-2.5 6 M33 36 l-2.5 6" fill="none" style="stroke:#3a9bdc;stroke-width:3.5"/>`,
  storm: `${cloud('#f0b48a')}<path d="M6 37 H29 a3 3 0 1 0 -3 -3 M13 43 H38 a3 3 0 1 1 -3 -3" fill="none"/>`,
  heat: sun,
  cache: `<rect x="7" y="17" width="34" height="25" rx="3" fill="#d4874a"/><path d="M7 17 L41 42 M41 17 L7 42" fill="none" style="stroke-width:2.5"/><rect x="5" y="10" width="38" height="8" rx="3" fill="#e59b5a"/><circle cx="24" cy="29" r="5" fill="#ffd23f"/>`,
  rocket: `<path d="M18 32 Q24 47 30 32 Z" fill="#ffd23f"/><path d="M16 25 L8 36 L16 34 Z M32 25 L40 36 L32 34 Z" fill="#ff5f57"/><path d="M24 3 Q35 13 32 33 H16 Q13 13 24 3 Z" fill="#fff1d6"/><circle cx="24" cy="18" r="4.5" fill="#5ed3f3"/>`,
  infinity: `<path d="M24 24 C18 13 6 13 6 24 C6 35 18 35 24 24 C30 13 42 13 42 24 C42 35 30 35 24 24 Z" fill="none" style="stroke-width:9"/><path class="ns" d="M24 24 C18 13 6 13 6 24 C6 35 18 35 24 24 C30 13 42 13 42 24 C42 35 30 35 24 24 Z" fill="none" style="stroke:#b18cff;stroke-width:4"/>`,
  heart: `<path d="M24 41 C10 31 5 24 5 17 a9.5 9.5 0 0 1 19 -3 a9.5 9.5 0 0 1 19 3 C43 24 38 31 24 41 Z" fill="#ff7eb6"/><path class="hl" d="M11 16 q1 -4 5 -5"/>`
};

export function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 48 48" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
}
