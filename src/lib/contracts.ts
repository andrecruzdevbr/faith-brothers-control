export type ContractWindow = {
  id: string;
  starts_on: string;
  ends_on: string;
  contract_status: string;
};

/** Active contract whose window contains `today`. Newest end date wins. */
export function selectCurrentContract<T extends ContractWindow>(
  contracts: T[],
  today: string,
): T | null {
  const current = contracts.filter(
    (contract) =>
      contract.contract_status === "ativo" &&
      contract.starts_on <= today &&
      contract.ends_on >= today,
  );
  if (!current.length) return null;
  return [...current].sort((a, b) => b.ends_on.localeCompare(a.ends_on))[0];
}

export function contractNeedsRenewal(
  contract: { ends_on?: string | null; contract_status?: string | null } | null | undefined,
  today: string,
): boolean {
  if (!contract?.ends_on) return false;
  if (contract.contract_status === "cancelado") return false;
  return contract.ends_on < today;
}
