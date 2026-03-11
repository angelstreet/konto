export function kontoDeeplink(path: string) {
  return path.startsWith('/') ? path : `/${path}`;
}

export function kontoLoanDeeplink(loanId?: number | null) {
  return loanId ? `/loans/${loanId}` : '/loans';
}
