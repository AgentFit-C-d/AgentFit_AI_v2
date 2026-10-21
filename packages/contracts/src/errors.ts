export class ContractError extends Error {
  constructor(public readonly code: string) { super(code); }
}
