export class SecretGuard {
  constructor(names = (process.env.SECRET_ENV_NAMES || 'WBS_USERNAME,WBS_PASSWORD').split(',')) {
    if (names.some(n => !/^[A-Z][A-Z0-9_]*$/.test(n))) throw new Error('Invalid credential names');
    this.values = Object.fromEntries(names.filter(n => process.env[n]).map(n => [n, process.env[n]]));
    this.variants = new Set(Object.values(this.values).flatMap(v => [v, JSON.stringify(v).slice(1, -1),
      encodeURIComponent(v), Buffer.from(v).toString('base64')]));
  }
  clean(text) {
    for (const secret of [...this.variants].sort((a,b) => b.length-a.length)) text = text.split(secret).join('[REDACTED]');
    return text.replace(/(bearer\s+)[\w.~/+=-]+/gi, '$1[REDACTED]')
      .replace(/((?:token|api[_-]?key|password|authorization|cookie)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  }
  object(value) {
    if (typeof value === 'string') return this.clean(value);
    if (Array.isArray(value)) return value.map(v => this.object(v));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,this.object(v)]));
    return value;
  }
  hasSecret(text) { return [...this.variants].some(v => text.includes(v)); }
  assertCode(code) {
    if (this.clean(code) !== code || code.includes('<secret>') || code.includes('[REDACTED]'))
      throw new Error('Recording contains secret-bearing content; export refused');
    return code;
  }
}
