// Plain-English medicine descriptions for the demo. Deliberately small.
// Each entry is a general "what is this medicine" description with a source to read in full.
// It contains NO dosing advice and NO interaction claims.
// Maintainers: re-check each source link before presenting; links may change.
export const MEDICINE_GLOSSARY = [
  { match: ['salbutamol', 'albuterol', 'ventolin'], name: 'Salbutamol (albuterol) inhaler', kind: 'Reliever inhaler',
    text: 'Relaxes the muscles around the airways so they open up. It is usually used when breathing symptoms come on.',
    source: { label: 'NHS: Salbutamol inhaler', url: 'https://www.nhs.uk/medicines/salbutamol-inhaler/' } },
  { match: ['beclometasone', 'beclomethasone', 'qvar', 'clenil'], name: 'Beclometasone inhaler', kind: 'Preventer inhaler (inhaled steroid)',
    text: 'Reduces swelling and irritation in the airways over time. Preventers are usually taken regularly, even on days without symptoms.',
    source: { label: 'NHS: Beclometasone inhalers', url: 'https://www.nhs.uk/medicines/beclometasone-inhalers/' } },
  { match: ['montelukast', 'singulair'], name: 'Montelukast', kind: 'Leukotriene receptor antagonist (tablet)',
    text: 'Blocks chemicals in the body called leukotrienes that contribute to airway inflammation. It is used to help prevent asthma symptoms.',
    source: { label: 'NHS: Montelukast', url: 'https://www.nhs.uk/medicines/montelukast/' } },
  { match: ['tiotropium', 'spiriva'], name: 'Tiotropium inhaler', kind: 'Long-acting bronchodilator',
    text: 'Helps keep the airways open for a long period. It is commonly used for COPD and sometimes asthma.',
    source: { label: 'NHS: Tiotropium inhalers', url: 'https://www.nhs.uk/medicines/tiotropium-inhalers/' } },
];

export const explainMedicine = (name) => {
  const n = (name || '').toLowerCase();
  return MEDICINE_GLOSSARY.find((m) => m.match.some((k) => n.includes(k))) || null;
};
