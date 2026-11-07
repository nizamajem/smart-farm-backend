export function mcbMetric(state: { state: string; attributes?: { unit_of_measurement?: string }; last_updated?: string } | undefined, kind: 'power' | 'energy' | 'voltage' | 'current') {
  if (!state || !state.state.trim()) return null;
  const value = Number(state.state);
  const units: Record<string, number> = {
    power: { W: 1, kW: 1000 }, energy: { Wh: .001, kWh: 1 },
    voltage: { V: 1, mV: .001, kV: 1000 }, current: { A: 1, mA: .001 },
  }[kind];
  const factor = units[state.attributes?.unit_of_measurement ?? ''];
  if (!Number.isFinite(value) || value < 0 || factor == null || !Number.isFinite(value * factor)) return null;
  return { value: value * factor, updatedAt: state.last_updated || null };
}
