export function companyDomainsMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeDomain(left);
  const normalizedRight = normalizeDomain(right);
  return normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(`.${normalizedRight}`) ||
    normalizedRight.endsWith(`.${normalizedLeft}`);
}

function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}
