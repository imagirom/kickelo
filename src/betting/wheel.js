// Ten equally likely segments. Their sum is always ten times the amount at risk,
// including odd allowances: distribute half-ball rounding across the segments.
export function wheelSegments(amount) {
  if (!Number.isInteger(amount) || amount < 0 || amount > 20) throw new Error('Invalid allowance');
  return [0, 0, 0, Math.ceil(amount / 2), Math.floor(amount / 2), Math.floor(amount / 2),
    amount, amount, Math.ceil(amount * 1.5), amount * 5];
}
