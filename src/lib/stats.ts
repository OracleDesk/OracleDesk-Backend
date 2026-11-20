/** Small statistics helpers shared by the evaluation harness (#67) and calibration (#68). */

export interface Interval {
  lower: number;
  upper: number;
}

/**
 * Wilson score interval for a binomial proportion. `n` may be fractional (an
 * effective sample size). Returns [0, 1] when there is no data.
 * https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Wilson_score_interval
 */
/**
 * One-sided Clopper–Pearson upper bound on a binomial proportion.
 * Returns the smallest p̂ such that P(X ≤ k | n, p̂) = alpha.
 * Uses the beta-distribution quantile identity: upper = Beta(1-alpha; k+1, n-k).
 * Implemented via Newton–Raphson on the regularised incomplete beta function.
 * Returns 1 when k === n; returns 0 when n === 0.
 *
 * https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Clopper%E2%80%93Pearson_interval
 */
export function clopperPearsonUpper(k: number, n: number, alpha = 0.05): number {
  if (n === 0) return 1;
  if (k === n) return 1;
  if (k < 0) return 0;
  // Solve for p: I_p(k+1, n-k) = 1 - alpha, equivalently I_p(k+1, n-k) = 1 - alpha
  // We want Beta-quantile at (1-alpha) with a=k+1, b=n-k.
  const a = k + 1;
  const b = n - k;
  const target = 1 - alpha;
  // Newton–Raphson on the regularised incomplete beta I_p(a,b) = target
  let p = (a) / (a + b); // start at the mean
  for (let i = 0; i < 100; i++) {
    const fp = regularisedIncompleteBeta(p, a, b) - target;
    // Derivative of I_p(a,b) w.r.t. p = p^(a-1) * (1-p)^(b-1) / B(a,b)
    const dfp = Math.exp((a - 1) * Math.log(p) + (b - 1) * Math.log(1 - p) - logBeta(a, b));
    const delta = fp / dfp;
    p -= delta;
    p = Math.max(1e-12, Math.min(1 - 1e-12, p));
    if (Math.abs(delta) < 1e-10) break;
  }
  return Math.min(1, Math.max(0, p));
}

function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

function logGamma(x: number): number {
  // Lanczos approximation, g=7
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  const t = x + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularised incomplete beta function I_x(a, b) via continued fraction (Lentz). */
function regularisedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = logBeta(a, b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lbeta) / a;
  // Use symmetry relation for faster convergence when x > (a+1)/(a+b+2)
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularisedIncompleteBeta(1 - x, b, a);
  }
  return front * betaCf(x, a, b);
}

function betaCf(x: number, a: number, b: number): number {
  const MAXIT = 200;
  const EPS = 3e-7;
  let c = 1, d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    // Even step
    let aa = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d; h *= d * c;
    // Odd step
    aa = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c; h *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }
  return h;
}

export function wilson(successes: number, n: number, z = 1.96): Interval {
  if (!(n > 0)) return { lower: 0, upper: 1 };
  const p = Math.min(1, Math.max(0, successes / n));
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}
