export type ChecklistItem = {
  id: string;
  label: string;
  done: boolean;
  note?: string;
};

export const DUE_DILIGENCE_ITEMS: ReadonlyArray<{ id: string; label: string }> = [
  {
    id: 'identity-verified',
    label: 'Shipper and consignee identities reviewed',
  },
  {
    id: 'documents-complete',
    label: 'Supporting documents are complete',
  },
  {
    id: 'sanctions-rationale',
    label: 'Sanctions or embargo match reviewed with a written rationale',
  },
  {
    id: 'goods-consistent',
    label: 'Goods description is consistent with HS code and routing',
  },
];

export function defaultChecklist(): ChecklistItem[] {
  return DUE_DILIGENCE_ITEMS.map((item) => ({
    id: item.id,
    label: item.label,
    done: false,
  }));
}

export function mergeChecklist(
  current: ChecklistItem[],
  updates: Array<{ id: string; done: boolean; note?: string }>,
): ChecklistItem[] {
  const allowed = new Set(DUE_DILIGENCE_ITEMS.map((item) => item.id));
  const byId = new Map(current.map((item) => [item.id, { ...item }]));
  for (const update of updates) {
    if (!allowed.has(update.id) || !byId.has(update.id)) {
      continue;
    }
    const item = byId.get(update.id)!;
    item.done = update.done;
    if (update.note !== undefined) {
      item.note = update.note;
    }
  }
  return DUE_DILIGENCE_ITEMS.map((def) => byId.get(def.id)!);
}

export function checklistComplete(items: ChecklistItem[]): boolean {
  return items.length === DUE_DILIGENCE_ITEMS.length && items.every((item) => item.done);
}
