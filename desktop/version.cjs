/** Version order for updates, apart from Electron so it can be tested. */

/** Whether version a is newer than b: 1.2.3 > 1.2.3-beta.2 > 1.2.3-beta.1 > 1.2.2. */
function newer(a, b) {
  const parse = (v) => {
    const [core, pre = ""] = String(v).replace(/^v/, "").split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) {
    if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) > (y.nums[i] ?? 0);
  }
  if (x.pre === y.pre) return false;
  if (!x.pre) return true; // the release itself is newer than its betas
  if (!y.pre) return false;
  const [p, q] = [x.pre.split("."), y.pre.split(".")];
  for (let i = 0; i < Math.max(p.length, q.length); i += 1) {
    if (p[i] === q[i]) continue;
    if (p[i] === undefined) return false;
    if (q[i] === undefined) return true;
    const [m, n] = [Number(p[i]), Number(q[i])];
    return Number.isFinite(m) && Number.isFinite(n) ? m > n : p[i] > q[i];
  }
  return false;
}

module.exports = { newer };
